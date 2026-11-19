import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { authenticate, hashPassword, hashToken, issueTokens, verifyPasswordWithTiming, verifyRefreshToken } from './auth.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { sendError } from './errors.js';
import { canAccessPublishedCourse, canManageCourse, containsText, isTrustedOrigin } from './access.js';
import { passwordSchema } from './validation.js';

const app = Fastify({ logger: true, requestIdHeader: 'x-request-id', trustProxy: config.NODE_ENV === 'production' });

await app.register(helmet);
await app.register(cookie);
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.NODE_ENV !== 'production' || origin === config.WEB_ORIGIN) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by the CodeBros API.'), false);
  },
  credentials: true
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().max(160), password: passwordSchema });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const profileSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().max(160) });
const runSchema = z.object({ source: z.string().max(50000), language: z.string().min(1).max(40) });
const quizSchema = z.object({ answers: z.record(z.string(), z.string()) });
const courseSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(20).max(1000),
  level: z.string().trim().min(2).max(30),
  accent: z.string().trim().min(2).max(30),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT')
});

function refreshCookieOptions() {
  const production = config.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: production ? 'none' as const : 'lax' as const, secure: production, path: '/api/auth' };
}

function setAuthCookies(reply: any, refreshToken: string) {
  reply.setCookie('refresh_token', refreshToken, refreshCookieOptions());
}

// Browsers send Origin on cross-origin POST requests. Production cookie endpoints
// require it to match the configured frontend instead of relying on a readable cookie.
function requireTrustedOrigin(request: any, reply: any) {
  if (!isTrustedOrigin(request.headers.origin, config.WEB_ORIGIN, config.NODE_ENV === 'production')) {
    sendError(reply, 403, 'ORIGIN_NOT_ALLOWED', 'This request did not come from an allowed origin.');
    return false;
  }
  return true;
}

const usesSqlite = config.DATABASE_URL.startsWith('file:');

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function jsonForDatabase(value: unknown): any {
  return config.DATABASE_URL.startsWith('file:')
    ? JSON.stringify(value)
    : value;
}

app.get('/api/health', async () => {
  let database: 'up' | 'down' = 'up';
  try { await prisma.$queryRaw`SELECT 1`; } catch { database = 'down'; }
  return { ok: database === 'up', service: 'codebros-api', database, timestamp: new Date().toISOString() };
});

app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Please check the account details.', parsed.error.flatten());
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return sendError(reply, 409, 'EMAIL_IN_USE', 'An account with this email already exists.');
  const { password, ...profile } = parsed.data;
  const user = await prisma.user.create({ data: { ...profile, email, passwordHash: await hashPassword(password) } });
  const tokens = await issueTokens({ id: user.id, email: user.email, name: user.name, role: user.role as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' });
  setAuthCookies(reply, tokens.refreshToken);
  return reply.code(201).send({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, accessToken: tokens.accessToken });
});

app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Email and password are required.');
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  const passwordValid = await verifyPasswordWithTiming(user?.passwordHash ?? null, parsed.data.password);
  if (!user || !passwordValid) return sendError(reply, 401, 'AUTH_INVALID', 'Email or password is incorrect.');
  const tokens = await issueTokens({ id: user.id, email: user.email, name: user.name, role: user.role as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' });
  setAuthCookies(reply, tokens.refreshToken);
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, accessToken: tokens.accessToken };
});

app.post('/api/auth/refresh', async (request, reply) => {
  if (!requireTrustedOrigin(request, reply)) return;
  const refreshToken = request.cookies.refresh_token;
  if (!refreshToken) return sendError(reply, 401, 'AUTH_REQUIRED', 'A refresh session is required.');
  try {
    const user = await verifyRefreshToken(refreshToken);
    if (!user) return sendError(reply, 401, 'AUTH_INVALID', 'The refresh session is invalid or expired.');
    await prisma.refreshToken.delete({ where: { tokenHash: hashToken(refreshToken) } });
    const tokens = await issueTokens({ id: user.id, email: user.email, name: user.name, role: user.role as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' });
    setAuthCookies(reply, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  } catch {
    return sendError(reply, 401, 'AUTH_INVALID', 'The refresh session is invalid or expired.');
  }
});

app.post('/api/auth/logout', async (request, reply) => {
  if (!requireTrustedOrigin(request, reply)) return;
  const refreshToken = request.cookies.refresh_token;
  if (refreshToken) await prisma.refreshToken.deleteMany({ where: { tokenHash: hashToken(refreshToken) } });
  reply.clearCookie('refresh_token', refreshCookieOptions());
  return { ok: true };
});

app.get('/api/me', async (request, reply) => {
  const user = await authenticate(request, reply);
  if (!user) return;
  return { user };
});

app.patch('/api/me', async (request, reply) => {
  const user = await authenticate(request, reply);
  if (!user) return;
  const parsed = profileSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Profile details are invalid.', parsed.error.flatten());
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { email, NOT: { id: user.id } } });
  if (existing) return sendError(reply, 409, 'EMAIL_IN_USE', 'An account with this email already exists.');
  const updated = await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name, email } });
  return { user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } };
});

app.get('/api/courses', async (request) => {
  const query = z.object({ search: z.string().optional(), level: z.string().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(12) }).parse(request.query);
  const where = { status: 'PUBLISHED' as const, ...(query.level ? { level: query.level } : {}), ...(query.search ? { OR: [{ title: containsText(query.search, usesSqlite) }, { description: containsText(query.search, usesSqlite) }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.course.findMany({
      where,
      select: {
        id: true, slug: true, title: true, description: true, level: true, accent: true, status: true, createdAt: true,
        tags: { select: { tag: { select: { id: true, name: true } } } },
        modules: { select: { id: true, title: true, position: true, lessons: { select: { id: true, title: true, slug: true, position: true, summary: true } }, }, orderBy: { position: 'asc' } },
        _count: { select: { enrollments: true } }
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.course.count({ where })
  ]);
  return { items, page: query.page, limit: query.limit, total };
});

app.get('/api/challenges/featured', async (_request, reply) => {
  const challenge = await prisma.challenge.findFirst({
    where: { lesson: { module: { course: { status: 'PUBLISHED' } } } },
    orderBy: { lesson: { module: { course: { createdAt: 'asc' } } } },
    select: { id: true, title: true, instructions: true, language: true, starterCode: true, lessonId: true }
  });
  if (!challenge) return sendError(reply, 404, 'CHALLENGE_NOT_FOUND', 'No practice challenge is published yet.');
  return { challenge };
});

app.get('/api/courses/:courseId/lessons/:lessonId', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const { courseId, lessonId } = z.object({ courseId: z.string(), lessonId: z.string() }).parse(request.params);
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } }, include: { course: true } });
  if (!canAccessPublishedCourse(Boolean(enrollment), enrollment?.course.status ?? '')) return sendError(reply, 403, 'ENROLLMENT_REQUIRED', 'Enroll in this published course to access its lessons.');
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, module: { courseId, course: { status: 'PUBLISHED' } } },
    include: { challenge: { select: { id: true, title: true, instructions: true, language: true, starterCode: true, lessonId: true } }, quiz: { include: { questions: { orderBy: { position: 'asc' } } } } }
  });
  if (!lesson) return sendError(reply, 404, 'LESSON_NOT_FOUND', 'That lesson does not exist in this course.');
  return { lesson: { ...lesson, quiz: lesson.quiz ? { ...lesson.quiz, questions: lesson.quiz.questions.map(({ answer: _answer, ...question }) => ({ ...question, options: parseJsonValue<string[]>(question.options, []) })) } : null } };
});

app.post('/api/courses/:courseId/enroll', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const params = z.object({ courseId: z.string() }).parse(request.params);
  const course = await prisma.course.findFirst({ where: { id: params.courseId, status: 'PUBLISHED' } });
  if (!course) return sendError(reply, 404, 'COURSE_NOT_FOUND', 'That course is not available.');
  const enrollment = await prisma.enrollment.upsert({ where: { userId_courseId: { userId: user.id, courseId: course.id } }, create: { userId: user.id, courseId: course.id }, update: {} });
  await prisma.activity.create({ data: { userId: user.id, type: 'COURSE_ENROLLED', metadata: jsonForDatabase({ courseId: course.id }) } });
  return reply.code(201).send({ enrollment });
});

app.get('/api/dashboard', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const [enrollments, completions, attempts, runs] = await Promise.all([
    prisma.enrollment.findMany({ where: { userId: user.id }, include: { course: { include: { modules: { include: { lessons: true } } } } } }),
    prisma.lessonCompletion.count({ where: { userId: user.id } }),
    prisma.quizAttempt.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.codeRun.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 })
  ]);
  const lessonTotal = enrollments.reduce((sum, item) => sum + item.course.modules.reduce((moduleSum, module) => moduleSum + module.lessons.length, 0), 0);
  return { user, stats: { enrolledCourses: enrollments.length, completedLessons: completions, lessonTotal, completionPercent: lessonTotal ? Math.round((completions / lessonTotal) * 100) : 0 }, recentQuizAttempts: attempts, recentCodeRuns: runs };
});

app.get('/api/progress', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const [completions, activities] = await Promise.all([
    prisma.lessonCompletion.findMany({ where: { userId: user.id }, include: { lesson: { include: { module: { include: { course: true } } } } }, orderBy: { completedAt: 'desc' } }),
    prisma.activity.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 })
  ]);
  const byCourse = new Map<string, { courseId: string; title: string; completedLessons: number }>();
  for (const completion of completions) {
    const course = completion.lesson.module.course;
    const current = byCourse.get(course.id) ?? { courseId: course.id, title: course.title, completedLessons: 0 };
    current.completedLessons += 1;
    byCourse.set(course.id, current);
  }
  return { courses: [...byCourse.values()], recentActivity: activities };
});

app.post('/api/lessons/:lessonId/complete', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const { lessonId } = z.object({ lessonId: z.string() }).parse(request.params);
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { include: { course: true } } } });
  if (!lesson) return sendError(reply, 404, 'LESSON_NOT_FOUND', 'That lesson does not exist.');
  const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: lesson.module.courseId } } });
  if (!canAccessPublishedCourse(Boolean(enrollment), lesson.module.course.status)) return sendError(reply, 403, 'ENROLLMENT_REQUIRED', 'Enroll in this published course before completing its lessons.');
  const completion = await prisma.lessonCompletion.upsert({ where: { userId_lessonId: { userId: user.id, lessonId } }, create: { userId: user.id, lessonId }, update: {} });
  await prisma.activity.create({ data: { userId: user.id, type: 'LESSON_COMPLETED', metadata: jsonForDatabase({ lessonId }) } });
  return { completion };
});

app.post('/api/quizzes/:quizId/attempts', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const { quizId } = z.object({ quizId: z.string() }).parse(request.params);
  const parsed = quizSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Answers must be supplied as a question-to-answer map.');
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { questions: true, lesson: { include: { module: true } } } });
  if (!quiz) return sendError(reply, 404, 'QUIZ_NOT_FOUND', 'That quiz does not exist.');
  const course = await prisma.course.findUnique({ where: { id: quiz.lesson.module.courseId } });
  const enrollment = course ? await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }) : null;
  if (!course || !canAccessPublishedCourse(Boolean(enrollment), course.status)) {
    return sendError(reply, 403, 'ENROLLMENT_REQUIRED', 'Enroll in this published course before submitting a quiz.');
  }
  const score = quiz.questions.reduce((total, question) => total + (parsed.data.answers[question.id] === question.answer ? 1 : 0), 0);
  const attempt = await prisma.quizAttempt.create({ data: { userId: user.id, quizId, score, total: quiz.questions.length, answers: jsonForDatabase(parsed.data.answers) } });
  return reply.code(201).send({ attempt, feedback: score === quiz.questions.length ? 'Perfect run. You can move on.' : `${score}/${quiz.questions.length} correct. Review the lesson and try again.` });
});

app.get('/api/quizzes/:quizId', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const { quizId } = z.object({ quizId: z.string() }).parse(request.params);
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      lesson: { include: { module: { include: { course: true } } } },
      questions: { orderBy: { position: 'asc' } }
    }
  });
  if (!quiz) return sendError(reply, 404, 'QUIZ_NOT_FOUND', 'That quiz does not exist.');
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: quiz.lesson.module.courseId } }
  });
  if (!canAccessPublishedCourse(Boolean(enrollment), quiz.lesson.module.course.status)) {
    return sendError(reply, 403, 'ENROLLMENT_REQUIRED', 'Enroll in this published course to access this quiz.');
  }
  const { lesson: _lesson, ...quizData } = quiz;
  const sanitizedQuiz = { ...quizData, questions: quizData.questions.map(({ answer: _answer, ...question }) => ({ ...question, options: parseJsonValue<string[]>(question.options, []) })) };
  return { quiz: sanitizedQuiz };
});

app.get('/api/quizzes/featured', async (_request, reply) => {
  const quiz = await prisma.quiz.findFirst({
    where: { lesson: { module: { course: { status: 'PUBLISHED' } } } },
    orderBy: { lesson: { module: { course: { createdAt: 'asc' } } } }
  });
  if (!quiz) return sendError(reply, 404, 'QUIZ_NOT_FOUND', 'No published quiz is available yet.');
  return { quizId: quiz.id };
});

app.post('/api/challenges/:challengeId/runs', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  const { challengeId } = z.object({ challengeId: z.string() }).parse(request.params);
  const parsed = runSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'A language and source string are required.');
  const challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
  if (!challenge) return sendError(reply, 404, 'CHALLENGE_NOT_FOUND', 'That challenge does not exist.');
  const challengeContext = await prisma.challenge.findUnique({ where: { id: challengeId }, include: { lesson: { include: { module: true } } } });
  const course = challengeContext ? await prisma.course.findUnique({ where: { id: challengeContext.lesson.module.courseId } }) : null;
  const enrollment = course ? await prisma.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId: course.id } } }) : null;
  if (!course || !canAccessPublishedCourse(Boolean(enrollment), course.status)) {
    return sendError(reply, 403, 'ENROLLMENT_REQUIRED', 'Enroll in this published course before running its challenges.');
  }
  if (parsed.data.language !== challenge.language) return sendError(reply, 400, 'LANGUAGE_MISMATCH', 'Use the language configured for this challenge.');
  return sendError(reply, 503, 'RUNNER_UNAVAILABLE', 'Secure challenge execution is not available yet. Results are not recorded.');
});

app.get('/api/admin/overview', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  if (user.role !== 'ADMIN' && user.role !== 'INSTRUCTOR') return sendError(reply, 403, 'FORBIDDEN', 'Admin access is required.');
  const [students, courses, enrollments, runs] = await Promise.all([prisma.user.count({ where: { role: 'STUDENT' } }), prisma.course.count(), prisma.enrollment.count(), prisma.codeRun.count()]);
  return { students, courses, enrollments, codeRuns: runs };
});

app.get('/api/admin/students', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  if (user.role !== 'ADMIN') return sendError(reply, 403, 'FORBIDDEN', 'Admin access is required.');
  const query = z.object({ search: z.string().optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const where = { role: 'STUDENT' as const, ...(query.search ? { OR: [{ name: containsText(query.search, usesSqlite) }, { email: containsText(query.search, usesSqlite) }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({ where, select: { id: true, name: true, email: true, createdAt: true, _count: { select: { enrollments: true, completions: true, codeRuns: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where })
  ]);
  return { items, page: query.page, limit: query.limit, total };
});

app.post('/api/admin/courses', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  if (user.role !== 'ADMIN' && user.role !== 'INSTRUCTOR') return sendError(reply, 403, 'FORBIDDEN', 'Instructor or admin access is required.');
  const parsed = courseSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Course details are invalid.', parsed.error.flatten());
  const existing = await prisma.course.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return sendError(reply, 409, 'SLUG_IN_USE', 'Choose a unique course slug.');
  const course = await prisma.course.create({ data: { ...parsed.data, ownerId: user.role === 'INSTRUCTOR' ? user.id : null } });
  return reply.code(201).send({ course });
});

app.patch('/api/admin/courses/:courseId', async (request, reply) => {
  const user = await authenticate(request, reply); if (!user) return;
  if (user.role !== 'ADMIN' && user.role !== 'INSTRUCTOR') return sendError(reply, 403, 'FORBIDDEN', 'Instructor or admin access is required.');
  const { courseId } = z.object({ courseId: z.string() }).parse(request.params);
  const parsed = z.object({ title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().min(20).max(1000).optional(), level: z.string().trim().min(2).max(30).optional(), accent: z.string().trim().min(2).max(30).optional(), status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional() }).safeParse(request.body);
  if (!parsed.success) return sendError(reply, 400, 'VALIDATION_ERROR', 'Course updates are invalid.', parsed.error.flatten());
  const existing = await prisma.course.findUnique({ where: { id: courseId } });
  if (!existing) return sendError(reply, 404, 'COURSE_NOT_FOUND', 'That course does not exist.');
  if (!canManageCourse(user.role, user.id, existing.ownerId)) return sendError(reply, 403, 'FORBIDDEN', 'Instructors may only update courses they own.');
  const course = await prisma.course.update({ where: { id: courseId }, data: parsed.data });
  return { course };
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof z.ZodError) return sendError(reply, 400, 'VALIDATION_ERROR', 'The request could not be validated.', error.flatten());
  const errorRecord = typeof error === 'object' && error !== null ? error as { statusCode?: unknown; message?: unknown } : {};
  const statusCode = typeof errorRecord.statusCode === 'number' && errorRecord.statusCode >= 400 && errorRecord.statusCode < 600 ? errorRecord.statusCode : 500;
  if (statusCode === 404) return sendError(reply, 404, 'NOT_FOUND', 'The requested resource was not found.');
  if (statusCode === 429) return sendError(reply, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
  if (statusCode >= 400 && statusCode < 500) {
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : 'The request could not be processed.';
    return sendError(reply, statusCode, 'REQUEST_ERROR', message);
  }
  return sendError(reply, 500, 'INTERNAL_ERROR', 'Something went wrong while processing the request.');
});

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPoint && process.env.NODE_ENV !== 'test') await start();

export { app };
