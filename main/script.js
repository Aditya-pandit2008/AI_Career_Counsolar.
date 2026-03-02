// chat.js — Full Chat + FREE STT + FREE TTS + Queue + Controls (No Waveform)
// UX: shows "Listening..." and "Thinking..." states + Theme toggle friendly

document.addEventListener("DOMContentLoaded", () => {
  const input = document.querySelector(".main-search-input");
  const searchBtn = document.querySelector(".main-search-button");
  const form = document.getElementById("career-form");
  const chatContainer = document.getElementById("ai-chat-container");
  const micBtn = document.getElementById("micBtn");

  let answers = {};
  let questionCount = 0;
  const MAX_QUESTIONS = 7;

  // ===== Language helpers =====
  function getReplyMode() {
    // expected: "en", "hi", "mr"
    return document.getElementById("replyMode")?.value || "en";
  }

  function getSTTLang() {
    const mode = getReplyMode();
    if (mode === "hi") return "hi-IN";
    if (mode === "mr") return "mr-IN";
    return "en-IN";
  }

  function detectTTSLang(text) {
    // Devanagari (Hindi + Marathi)
    if (/[\u0900-\u097F]/.test(text)) {
      return getReplyMode() === "mr" ? "mr-IN" : "hi-IN";
    }
    return "en-IN";
  }

  // ================= FREE TTS (Browser) =================
  function speakFreeTTS(text) {
    if (!("speechSynthesis" in window)) {
      alert("Text-to-Speech not supported in this browser.");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const mode = getReplyMode();

    if (mode === "hi") utterance.lang = "hi-IN";
    else if (mode === "mr") utterance.lang = "mr-IN";
    else utterance.lang = detectTTSLang(text);

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1; // valid range: 0.0 – 1.0

    window.speechSynthesis.cancel(); // stop previous speech
    window.speechSynthesis.speak(utterance);
  }

  // ================= INIT MESSAGE =================
  fetch("/api/career", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init: true, mode: getReplyMode() })
  })
    .then(res => res.json())
    .then(data => {
      if (data.message) appendMessage("assistant", data.message);
    })
    .catch(() => {});

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    onSearch();
  });

  function appendMessage(role, text) {
    const msgWrap = document.createElement("div");
    msgWrap.style.display = "flex";
    msgWrap.style.flexDirection = "column";
    msgWrap.style.gap = "6px";
    msgWrap.style.maxWidth = "90%";
    msgWrap.style.margin = "12px 0";

    const msg = document.createElement("div");
    msg.style.padding = "14px 18px";
    msg.style.borderRadius = "18px";
    msg.style.whiteSpace = "pre-wrap";
    msg.style.lineHeight = "1.6";
    msg.style.fontSize = "14.5px";
    msg.style.boxShadow = "0 6px 16px rgba(0,0,0,0.08)";

    if (role === "user") {
      msgWrap.style.marginLeft = "auto";
      msg.style.background = "linear-gradient(135deg, #6366F1, #22C55E)";
      msg.style.color = "#fff";
    } else {
      msgWrap.style.marginRight = "auto";
      msg.style.background = "#fff";
      msg.style.color = "#0f172a";
      msg.style.border = "1px solid rgba(99,102,241,0.15)";
    }

    msg.textContent = text;
    msgWrap.appendChild(msg);
    chatContainer.appendChild(msgWrap);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // 🔊 Listen Button (Free TTS)
    if (role !== "user") {
      const speakBtn = document.createElement("button");
      speakBtn.textContent = "🔊 Listen";
      speakBtn.style.alignSelf = "flex-start";
      speakBtn.style.border = "none";
      speakBtn.style.background = "#6366F1";
      speakBtn.style.color = "#fff";
      speakBtn.style.padding = "6px 12px";
      speakBtn.style.borderRadius = "999px";
      speakBtn.style.cursor = "pointer";
      speakBtn.style.fontSize = "12px";
      speakBtn.onclick = () => speakFreeTTS(text);

      msgWrap.appendChild(speakBtn);
    }
  }

  function showQuickReplies(options = []) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";
    wrap.style.margin = "6px 0 12px";

    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.textContent = opt;
      btn.style.padding = "6px 12px";
      btn.style.borderRadius = "999px";
      btn.style.border = "1px solid #6366F1";
      btn.style.background = "#EEF2FF";
      btn.style.color = "#3730A3";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "12px";

      btn.onclick = () => {
        input.value = opt;
        form.requestSubmit();
        wrap.remove();
      };

      wrap.appendChild(btn);
    });

    chatContainer.appendChild(wrap);
  }

  function setLoading(isLoading) {
    input.disabled = isLoading;
    searchBtn.disabled = isLoading;
    searchBtn.textContent = isLoading ? "Thinking..." : "Send";
  }

  async function onSearch() {
    const query = (input.value || "").trim();
    if (!query) return;

    appendMessage("user", query);
    input.value = "";
    setLoading(true);

    const typing = document.createElement("div");
    typing.textContent = "🤖 Thinking...";
    typing.style.fontSize = "13px";
    typing.style.color = "#6b7280";
    chatContainer.appendChild(typing);

    try {
      if (questionCount > 0) answers[`q${questionCount}`] = query;

      const res = await fetch("/api/career", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          answers,
          done: questionCount >= MAX_QUESTIONS,
          mode: getReplyMode()
        })
      });

      const data = await res.json();
      typing.remove();

      if (!res.ok) throw new Error(data?.error || "Server error");

      if (data.type === "question") {
        appendMessage("assistant", data.question);
        showQuickReplies(["Student", "Working professional", "Career switcher", "Not sure"]);
        questionCount++;
      } else if (data.type === "career") {
        appendMessage("assistant", data.result);
      } else if (data.message) {
        appendMessage("assistant", data.message);
      }
    } catch (err) {
      typing.remove();
      appendMessage("assistant", "⚠️ Backend error. Check console.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ================= SKIP BUTTON =================
  const skipBtn = document.createElement("button");
  skipBtn.textContent = "⏭️ Skip";
  skipBtn.style.position = "fixed";
  skipBtn.style.bottom = "90px";
  skipBtn.style.right = "16px";
  skipBtn.style.padding = "8px 12px";
  skipBtn.style.borderRadius = "999px";
  skipBtn.style.border = "none";
  skipBtn.style.background = "#e5e7eb";
  skipBtn.style.cursor = "pointer";
  skipBtn.style.fontSize = "12px";

  skipBtn.onclick = () => {
    appendMessage("user", "Skipped");
    fetch("/api/career", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "SKIP",
        answers,
        done: questionCount >= MAX_QUESTIONS,
        mode: getReplyMode()
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.type === "question") {
          appendMessage("assistant", data.question);
          questionCount++;
        }
      })
      .catch(() => {});
  };

  document.body.appendChild(skipBtn);

  // ================= FREE STT (Browser) =================
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.disabled = true;
    micBtn.textContent = "❌";
  } else {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    micBtn.addEventListener("click", () => {
      recognition.lang = getSTTLang(); // en-IN / hi-IN / mr-IN
      recognition.start();
      micBtn.textContent = "🎙️ Listening...";
    });

    recognition.onresult = (e) => {
      let finalText = "";
      let interim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += transcript + " ";
        else interim += transcript;
      }

      input.value = finalText + interim;

      if (finalText.trim()) {
        form.requestSubmit();
      }
    };

    recognition.onerror = () => {
      micBtn.textContent = "🎤";
    };

    recognition.onend = () => {
      micBtn.textContent = "🎤";
    };
  }
});
