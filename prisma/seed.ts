import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
const json = (value: unknown): any => isSqlite ? JSON.stringify(value) : value;

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seed is disabled in production. Set ALLOW_DEMO_SEED=true only for an explicitly authorized demo database.');
  }
  const demoPassword = process.env.DEMO_STUDENT_PASSWORD;
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  if (!demoPassword) {
    throw new Error('DEMO_STUDENT_PASSWORD is required to seed demo accounts.');
  }
  if (!adminPassword) {
    throw new Error('DEMO_ADMIN_PASSWORD is required to seed demo accounts.');
  }
  const passwordHash = await argon2.hash(demoPassword);
  const adminPasswordHash = await argon2.hash(adminPassword);
  const student = await prisma.user.upsert({ where: { email: 'demo@codebros.dev' }, update: { passwordHash }, create: { email: 'demo@codebros.dev', name: 'Demo Student', passwordHash, role: 'STUDENT' } });
  await prisma.user.upsert({ where: { email: 'admin@codebros.dev' }, update: { passwordHash: adminPasswordHash, role: 'ADMIN' }, create: { email: 'admin@codebros.dev', name: 'CodeBros Admin', passwordHash: adminPasswordHash, role: 'ADMIN' } });
  const course = await prisma.course.upsert({ where: { slug: 'javascript-foundations' }, update: {}, create: { slug: 'javascript-foundations', title: 'JavaScript Foundations', description: 'Build your first reliable mental model for variables, loops, and functions.', level: 'Beginner', accent: 'citrus', status: 'PUBLISHED' } });
  const module = await prisma.module.upsert({ where: { courseId_position: { courseId: course.id, position: 1 } }, update: {}, create: { courseId: course.id, title: 'Think in steps', position: 1 } });
  const lesson = await prisma.lesson.upsert({ where: { moduleId_position: { moduleId: module.id, position: 1 } }, update: {}, create: { moduleId: module.id, title: 'Loops that explain themselves', slug: 'loops-that-explain-themselves', position: 1, summary: 'Use loops to transform a list without losing your reasoning.', content: 'A loop is a repeatable decision. Start with the input, name the transformation, and make the output observable.' } });
  await prisma.challenge.upsert({ where: { lessonId: lesson.id }, update: {}, create: { lessonId: lesson.id, title: 'Count the bright spots', instructions: 'Write code that includes the expected result in its output.', language: 'javascript', starterCode: 'const result = [];\n// your code here', tests: json([{ label: 'contains 3', expected: '3' }, { label: 'contains 5', expected: '5' }]) } });
  const quiz = await prisma.quiz.upsert({ where: { lessonId: lesson.id }, update: {}, create: { lessonId: lesson.id, title: 'Loop checkpoint' } });
  await prisma.question.deleteMany({ where: { quizId: quiz.id } });
  await prisma.question.create({ data: { quizId: quiz.id, position: 1, prompt: 'What should a loop make easier to see?', options: json(['Repeated reasoning', 'Random output', 'Hidden state']), answer: 'Repeated reasoning' } });
  await prisma.enrollment.upsert({ where: { userId_courseId: { userId: student.id, courseId: course.id } }, update: {}, create: { userId: student.id, courseId: course.id } });
  const companionCourses = [
    { slug: 'python-problem-solving', title: 'Python Problem Solving', level: 'Beginner', language: 'python', accent: 'mineral' },
    { slug: 'html-css-launchpad', title: 'HTML and CSS Launchpad', level: 'Beginner', language: 'html-css', accent: 'coral' },
    { slug: 'java-object-thinking', title: 'Java Object Thinking', level: 'Intermediate', language: 'java', accent: 'lilac' },
    { slug: 'cpp-algorithm-lab', title: 'C++ Algorithm Lab', level: 'Intermediate', language: 'cpp', accent: 'citrus' }
  ];
  for (const item of companionCourses) {
    const companion = await prisma.course.upsert({
      where: { slug: item.slug },
      update: { status: 'PUBLISHED' },
      create: { slug: item.slug, title: item.title, description: `Build practical ${item.language} fluency through short, testable studio challenges.`, level: item.level, accent: item.accent, status: 'PUBLISHED' }
    });
    const companionModule = await prisma.module.upsert({ where: { courseId_position: { courseId: companion.id, position: 1 } }, update: {}, create: { courseId: companion.id, title: 'First principles', position: 1 } });
    const companionLesson = await prisma.lesson.upsert({ where: { moduleId_position: { moduleId: companionModule.id, position: 1 } }, update: {}, create: { moduleId: companionModule.id, title: `Your first ${item.language} pattern`, slug: `${item.slug}-first-pattern`, position: 1, summary: `Learn one useful ${item.language} pattern and prove it with a small challenge.`, content: 'Start with the input, name the transformation, and make the output observable.' } });
    await prisma.challenge.upsert({ where: { lessonId: companionLesson.id }, update: {}, create: { lessonId: companionLesson.id, title: `${item.language} pattern lab`, instructions: 'Write a small solution that includes the expected values in its output.', language: item.language, starterCode: '// your solution here', tests: json([{ label: 'contains 3', expected: '3' }]) } });
  }
  console.log('Seeded CodeBros demo data using the configured demo credentials.');
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(() => prisma.$disconnect());
