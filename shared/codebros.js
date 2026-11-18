(function () {
  "use strict";

  const API_BASE = localStorage.getItem("codebros_api_url") || "http://localhost:4000/api";
  const folder = window.location.pathname.split(/[\\/]/).slice(-2, -1)[0] || "";
  const tokenKey = "codebros_access_token";

  const routes = {
    signIn: "../codebros_sign_in/code.html",
    signUp: "../codebros_create_account/code.html",
    recovery: "../codebros_password_2fa_recovery/code.html",
    home: "../codebros_home/code.html",
    courses: "../course_catalog_discovery/code.html",
    dashboard: "../student_dashboard/code.html",
    lesson: "../course_lesson_player/code.html",
    quiz: "../interactive_quiz_assessment/code.html",
    ide: "../online_coding_ide/code.html",
    progress: "../student_progress_analytics/code.html",
    profile: "../student_profile_account_settings/code.html",
    admin: "../admin_dashboard/code.html"
  };

  function toast(message, tone) {
    const node = document.createElement("div");
    node.className = "cb-toast";
    node.textContent = message;
    if (tone === "error") node.style.borderColor = "#d05a3a";
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  async function request(path, options) {
    const config = Object.assign({ credentials: "include", headers: {} }, options || {});
    config.headers = Object.assign({ "Content-Type": "application/json" }, config.headers);
    const token = localStorage.getItem(tokenKey);
    if (token) config.headers.Authorization = "Bearer " + token;
    let response = await fetch(API_BASE + path, config);
    if (response.status === 401 && token) {
      const refresh = await fetch(API_BASE + "/auth/refresh", { method: "POST", credentials: "include" });
      if (refresh.ok) {
        const refreshed = await refresh.json();
        localStorage.setItem(tokenKey, refreshed.accessToken);
        config.headers.Authorization = "Bearer " + refreshed.accessToken;
        response = await fetch(API_BASE + path, config);
      }
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "The API request could not be completed.");
    return body;
  }

  function redirect(route) {
    if (routes[route]) window.location.href = routes[route];
  }

  function wireNavigation() {
    document.querySelectorAll("[data-path]").forEach((link) => {
      const path = link.getAttribute("data-path") || "";
      const mapping = {
        "sign-in": "signIn", "sign-up": "signUp", "forgot-password": "recovery", "explore-courses": "courses",
        courses: "courses", "student-curriculum": "dashboard", "platform-home": "home",
        "practice-ide": "ide", quizzes: "quiz", progress: "progress", profile: "profile",
        community: "home"
      };
      if (mapping[path]) {
        link.setAttribute("href", routes[mapping[path]]);
        link.addEventListener("click", () => localStorage.setItem("codebros_last_route", mapping[path]));
      }
    });
  }

  function formValues(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const inputs = Array.from(form.querySelectorAll("input"));
    const email = inputs.find((input) => input.type === "email");
    const passwords = inputs.filter((input) => input.type === "password");
    const textInputs = inputs.filter((input) => input.type === "text");
    if (!values.email && email) values.email = email.value;
    if (!values.password && passwords[0]) values.password = passwords[0].value;
    if (!values.confirmPassword && passwords[1]) values.confirmPassword = passwords[1].value;
    if (!values.name && textInputs[0]) values.name = textInputs[0].value;
    return values;
  }

  function wireAuth() {
    const login = document.querySelector("#loginForm");
    if (login) {
      login.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = login.querySelector("button[type=submit]");
        if (button) button.disabled = true;
        try {
          const values = formValues(login);
          const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email: values.email, password: values.password }) });
          localStorage.setItem(tokenKey, result.accessToken);
          toast("Signed in. Opening your studio...");
          window.setTimeout(() => redirect("dashboard"), 500);
        } catch (error) {
          toast(error.message, "error");
          if (button) button.disabled = false;
        }

        function wireLogout() {
          const logout = Array.from(document.querySelectorAll("a, button")).find((element) => /log\s*out/i.test(element.textContent || ""));
          if (!logout) return;
          logout.addEventListener("click", async (event) => {
            event.preventDefault();
            try { await request("/auth/logout", { method: "POST" }); } catch (_) { /* local cleanup still matters */ }
            localStorage.removeItem(tokenKey);
            redirect("signIn");
          });
        }
      });
    }

    const register = document.querySelector("form:not(#loginForm)");
    if (folder === "codebros_create_account" && register) {
      register.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = formValues(register);
        if (values.password !== values.confirmPassword && values.confirmPassword) {
          toast("Passwords do not match.", "error");
          return;
        }
        try {
          const result = await request("/auth/register", { method: "POST", body: JSON.stringify({ name: values.name || values.fullName || "New Student", email: values.email, password: values.password }) });
          localStorage.setItem(tokenKey, result.accessToken);
          toast("Account created. Welcome to CodeBros.");
          window.setTimeout(() => redirect("dashboard"), 500);
        } catch (error) {
          toast(error.message, "error");
        }
      });
    }
  }

  function addLivePanel(title, text) {
    const panel = document.createElement("section");
    panel.className = "cb-live-panel";
    panel.innerHTML = "<strong>" + title + "</strong><p style='margin:6px 0 0'>" + text + "</p>";
    const main = document.querySelector("main");
    if (main) main.prepend(panel);
  }

  async function wireDashboard() {
    if (folder !== "student_dashboard") return;
    try {
      const data = await request("/dashboard");
      const name = document.querySelector("main h1, main h2");
      if (name && data.user?.name) name.textContent = "Welcome back, " + data.user.name + ".";
      addLivePanel("Your live studio snapshot", data.stats.completedLessons + " lessons completed across " + data.stats.enrolledCourses + " enrolled course(s).");
    } catch (error) {
      addLivePanel("API connection needed", "Start the backend with npm run dev to load your live dashboard.");
    }
  }

  async function wireAdmin() {
    if (folder !== "admin_dashboard" && folder !== "admin_student_management") return;
    try {
      if (folder === "admin_dashboard") {
        const data = await request("/admin/overview");
        addLivePanel("Live operations", data.students + " students · " + data.courses + " courses · " + data.enrollments + " enrollments · " + data.codeRuns + " practice runs.");
      } else {
        const data = await request("/admin/students");
        const panel = document.createElement("section");
        panel.className = "cb-live-panel";
        panel.innerHTML = "<strong>Live student directory</strong><p style='margin:6px 0 12px'>" + escapeHtml(data.total) + " student(s) in the platform.</p>" + data.items.map((student) => "<div style='display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--cb-line)'><span>" + escapeHtml(student.name) + "</span><small>" + escapeHtml(student.email) + " · " + escapeHtml(student._count.completions) + " completions</small></div>").join("");
        document.querySelector("main")?.prepend(panel);
      }

      function wireCourseBuilder() {
        if (folder !== "admin_course_builder") return;
        const panel = document.createElement("section");
        panel.className = "cb-live-panel";
        panel.innerHTML = "<strong>Publish a course</strong><form class='cb-course-form' style='display:grid;gap:10px;margin-top:12px'>" +
          "<input name='title' required placeholder='Course title' aria-label='Course title'>" +
          "<input name='slug' required pattern='[a-z0-9]+(?:-[a-z0-9]+)*' placeholder='course-slug' aria-label='Course slug'>" +
          "<textarea name='description' required minlength='20' placeholder='What will students build?' aria-label='Course description'></textarea>" +
          "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px'><select name='level' aria-label='Course level'><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><input name='accent' required value='citrus' placeholder='Accent token' aria-label='Course accent'></div>" +
          "<label style='display:flex;gap:8px;align-items:center'><input type='checkbox' name='publish'> Publish immediately</label>" +
          "<button type='submit' style='background:var(--cb-mineral);color:white;padding:10px 14px;border:0;border-radius:10px'>Create course</button></form>";
        document.querySelector("main")?.prepend(panel);
        panel.querySelector("form")?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget).entries());
          try {
            const result = await request("/admin/courses", {
              method: "POST",
              body: JSON.stringify({
                title: values.title,
                slug: values.slug,
                description: values.description,
                level: values.level,
                accent: values.accent,
                status: values.publish ? "PUBLISHED" : "DRAFT"
              })
            });
            toast(result.course.title + " created.");
            event.currentTarget.reset();
          } catch (error) {
            toast(error.message, "error");
          }
        });
      }
    } catch (error) {
      addLivePanel("Admin API connection needed", error.message);
    }
  }

  async function wireCatalog() {
    if (folder !== "course_catalog_discovery") return;
    const search = document.querySelector("input[type=search], input[placeholder*='language' i], input[placeholder*='search' i]");
    let timer;
    if (search) {
      search.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => loadCatalog(search.value.trim()), 250);
      });
    }
    await loadCatalog(search?.value.trim() || "");
  }

  async function loadCatalog(searchTerm) {
    try {
      const data = await request("/courses" + (searchTerm ? "?search=" + encodeURIComponent(searchTerm) : ""));
      const existing = document.querySelector(".cb-catalog-live");
      if (existing) existing.remove();
      const panel = document.createElement("section");
      panel.className = "cb-live-panel cb-catalog-live";
      panel.innerHTML = "<strong>Live catalog</strong><p style='margin:6px 0 12px'>" + escapeHtml(data.total) + " published course(s) match your search.</p>";
      const first = data.items[0];
      if (first) {
        const button = document.createElement("button");
        button.textContent = "Enroll in " + first.title;
        button.className = "mt-3 px-4 py-2 rounded-lg text-white";
        button.style.background = "var(--cb-mineral)";
        button.onclick = async () => {
          try {
            await request("/courses/" + first.id + "/enroll", { method: "POST" });
            toast("Enrolled. Your next lesson is ready.");
            redirect("dashboard");
          } catch (error) { toast(error.message, "error"); }
        };
        panel.appendChild(button);
      } else {
        panel.innerHTML += "<span>No live course matched that search yet.</span>";
      }
      document.querySelector("main")?.prepend(panel);
    } catch (error) {
      addLivePanel("API connection needed", "Start the backend with npm run dev to load live courses.");
    }
  }

  async function wireLesson() {
    if (folder !== "course_lesson_player") return;
    const params = new URLSearchParams(window.location.search);
    const courseId = params.get("courseId");
    const lessonId = params.get("lessonId");
    if (!courseId || !lessonId) return;
    try {
      const data = await request("/courses/" + courseId + "/lessons/" + lessonId);
      const lesson = data.lesson;
      const heading = document.querySelector("main h1, main h2");
      if (heading) heading.textContent = lesson.title;
      addLivePanel("Live lesson", lesson.summary);
      const completeButton = Array.from(document.querySelectorAll("button")).find((button) => /complete|finish|mark/i.test(button.textContent || ""));
      if (completeButton) completeButton.dataset.lessonId = lesson.id;
      if (lesson.challenge) localStorage.setItem("codebros_featured_challenge", lesson.challenge.id);
    } catch (error) {
      addLivePanel("Lesson unavailable", error.message);
    }
  }

  async function wireQuiz() {
    if (folder !== "interactive_quiz_assessment") return;
    try {
      let quizId = new URLSearchParams(window.location.search).get("quizId");
      if (!quizId) {
        const featured = await request("/quizzes/featured");
        quizId = featured.quizId;
        window.history.replaceState({}, "", "?quizId=" + encodeURIComponent(quizId));
      }
      const data = await request("/quizzes/" + quizId);
      const group = document.querySelector("#optionsGroup");
      const question = data.quiz.questions[0];
      if (!group || !question) return;
      const prompt = document.querySelector("main h1, main h2");
      if (prompt) prompt.textContent = question.prompt;
      group.innerHTML = question.options.map((option, index) => "<label class='quiz-option flex items-center gap-3 p-3.5 rounded-lg bg-surface-container-lowest cursor-pointer'><input type='radio' name='live-answer' value='" + escapeHtml(option) + "'><span>" + String.fromCharCode(65 + index) + ". " + escapeHtml(option) + "</span></label>").join("");
      const submit = document.querySelector("#submitQuizBtn, button[type=submit]");
      if (submit) submit.addEventListener("click", async (event) => {
        event.preventDefault();
        const answer = document.querySelector("input[name=live-answer]:checked")?.value;
        if (!answer) return toast("Choose an answer first.", "error");
        try {
          const result = await request("/quizzes/" + quizId + "/attempts", { method: "POST", body: JSON.stringify({ answers: { [question.id]: answer } }) });
          toast(result.feedback, result.attempt.score === result.attempt.total ? "success" : "error");
        } catch (error) { toast(error.message, "error"); }
      });
    } catch (error) {
      addLivePanel("Quiz unavailable", error.message);
    }

    async function wireProgress() {
      if (folder !== "student_progress_analytics") return;
      try {
        const data = await request("/progress");
        const courseCount = data.courses.length;
        addLivePanel("Live progress", "You have activity across " + courseCount + " course(s) and " + data.recentActivity.length + " recent learning event(s).");
      } catch (error) {
        addLivePanel("Progress API connection needed", error.message);
      }
    }

    async function wireProfile() {
      if (folder !== "student_profile_account_settings") return;
      try {
        const data = await request("/me");
        addLivePanel("Live profile", data.user.name + " · " + data.user.email + " · " + data.user.role.toLowerCase());
      } catch (error) {
        addLivePanel("Profile API connection needed", error.message);
      }
    }
  }

  function wirePractice() {
    if (folder !== "online_coding_ide") return;
    const runButton = document.querySelector("#submit-btn");
    const editor = document.querySelector("textarea, [contenteditable=true]");
    if (!runButton || !editor) return;
    request("/challenges/featured").then((data) => {
      const challenge = data.challenge;
      if (editor.value !== undefined && !editor.value.trim()) editor.value = challenge.starterCode;
      const title = document.querySelector("main h1, main h2");
      if (title) title.textContent = challenge.title;
      addLivePanel("Practice mode: " + challenge.language, challenge.instructions);
    }).catch((error) => addLivePanel("Practice unavailable", error.message));
    runButton.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const featured = await request("/challenges/featured");
        const source = editor.value !== undefined ? editor.value : editor.textContent;
        const result = await request("/challenges/" + featured.challenge.id + "/runs", { method: "POST", body: JSON.stringify({ language: featured.challenge.language, source }) });
        toast(result.feedback, result.codeRun.status === "PASSED" ? "success" : "error");
      } catch (error) { toast(error.message, "error"); }
    });
  }

  function wireLessonCompletion() {
    if (folder !== "course_lesson_player") return;
    document.querySelectorAll("button").forEach((button) => {
      if (/complete|finish|mark/i.test(button.textContent || "")) {
        button.addEventListener("click", async () => {
          const lessonId = button.dataset.lessonId || new URLSearchParams(window.location.search).get("lessonId");
          if (!lessonId) return toast("Add ?lessonId=... to connect this lesson action.");
          try { await request("/lessons/" + lessonId + "/complete", { method: "POST" }); toast("Lesson completed. Progress updated."); }
          catch (error) { toast(error.message, "error"); }
        });
      }
    });
  }

  window.CodeBros = { request, redirect, toast, API_BASE };
  document.addEventListener("DOMContentLoaded", () => {
    wireNavigation();
    wireAuth();
    wireLogout();
    wireDashboard();
    wireAdmin();
    wireCourseBuilder();
    wireCatalog();
    wireLesson();
    wireQuiz();
    wireProgress();
    wireProfile();
    wirePractice();
    wireLessonCompletion();
  });
})();
