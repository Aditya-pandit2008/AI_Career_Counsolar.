import os
import requests
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
from io import BytesIO

# -------------------------
# Env loading
# -------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, "..", ".env"))

# -------------------------
# App setup
# -------------------------
app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

print("🔥 FULL BACKEND LOADED (NO DATABASE)")

# -------------------------
# Groq client
# -------------------------
API_KEY = os.getenv("GROQ_API_KEY")
if not API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing.")
client = Groq(api_key=API_KEY)

# -------------------------
# ElevenLabs (TTS)
# -------------------------
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
if not ELEVENLABS_API_KEY:
    print("⚠️ ELEVENLABS_API_KEY not found. TTS will fail.")

VOICE_EN = os.getenv("ELEVENLABS_VOICE_EN", "EXAVITQu4vr4xnSDxMaL")
VOICE_HI = os.getenv("ELEVENLABS_VOICE_HI", "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")

# -------------------------
# Language helper
# -------------------------
def language_instruction(mode: str):
    if mode == "hi":
        return "Reply only in simple Hindi (Devanagari)."
    if mode == "hinglish":
        return "Reply in Hinglish (Hindi + English mix, Roman script)."
    return "Reply in clear, simple English."

# -------------------------
# Prompt builders
# -------------------------
def build_init_prompt(mode="en"):
    lang_rule = language_instruction(mode)
    return [{
        "role": "system",
        "content": (
            "You are a polite, respectful, and supportive AI career mentor for Indian students and freshers. "
            "Always use light emojis naturally in your replies (like 👋 🙂 🎯), but do not overuse them. "
            + lang_rule + " "
            "Begin with a short, warm greeting. "
            "Then ask how you can help the user with their career or studies. "
            "Then ask 1 or 2 simple mentor-style questions to understand the user better. "
            "Ask a total of only 2 or 3 short questions. "
            "Do not give advice yet. Do not suggest careers yet. Do not use JSON."
        ),
    }]

def build_dynamic_question_prompt(profile: dict, answers: dict, last_user_message: str, mode="en"):
    lang_rule = language_instruction(mode)
    answers_text = "\n".join([f"- {k}: {v}" for k, v in answers.items()]) or "No answers yet."
    return [
        {
            "role": "system",
            "content": (
                "You are a polite, respectful, and supportive AI career mentor for Indian students and freshers. "
                "Always use light emojis naturally in your replies (like 🙂 🎯), but do not overuse them. "
                + lang_rule + " "
                "If the user's last message is unclear, politely ask them to clarify. "
                "If the user's last message is 'SKIP', move to the next useful question silently. "
                "Ask only ONE simple question. "
                "Do not provide advice yet. Do not suggest careers yet. Do not use JSON.\n\n"
                "Eventually ask about: education level, strongest skill, weakest skill, interests, time per day."
            ),
        },
        {
            "role": "user",
            "content": (
                f"User last message:\n{last_user_message}\n\n"
                f"Profile:\n"
                f"Education: {profile.get('education', 'Not provided')}\n"
                f"Skills: {', '.join(profile.get('skills', [])) or 'Not provided'}\n"
                f"Interests: {', '.join(profile.get('interests', [])) or 'Not provided'}\n"
                f"Goal: {profile.get('goal', 'Not provided')}\n\n"
                f"Previous answers:\n{answers_text}"
            ),
        },
    ]

def build_career_prompt(profile: dict, answers: dict, mode="en"):
    lang_rule = language_instruction(mode)
    answers_text = "\n".join([f"- {k}: {v}" for k, v in answers.items()]) or "No answers provided."
    return [
        {
            "role": "system",
            "content": (
                "You are a polite, respectful, and supportive AI career counselor for Indian students and freshers. "
                + lang_rule + " "
                "Suggest 4 or 5 suitable career options with short reasons and next steps. "
                "Keep it practical and beginner-friendly. Do not use JSON."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Profile:\n"
                f"Education: {profile.get('education', 'Not provided')}\n"
                f"Skills: {', '.join(profile.get('skills', [])) or 'Not provided'}\n"
                f"Interests: {', '.join(profile.get('interests', [])) or 'Not provided'}\n"
                f"Goal: {profile.get('goal', 'Not provided')}\n\n"
                f"User answers:\n{answers_text}"
            ),
        },
    ]

# -------------------------
# Routes
# -------------------------
@app.route("/api/tts", methods=["POST"])
def tts():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    mode = data.get("mode", "en")
    if not text:
        return jsonify({"error": "No text provided"}), 400

    voice_id = VOICE_HI if mode in ("hi", "hinglish") else VOICE_EN
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}
    payload = {"text": text, "model_id": ELEVENLABS_MODEL}

    r = requests.post(url, json=payload, headers=headers, timeout=60)
    if r.status_code != 200:
        return jsonify({"error": "ElevenLabs TTS failed"}), 500

    return send_file(BytesIO(r.content), mimetype="audio/mpeg")

@app.route("/api/career", methods=["POST"])
def career():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "en")

    if data.get("init") is True:
        messages = build_init_prompt(mode)
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant", messages=messages, temperature=0.3, max_tokens=140
        )
        return jsonify({"type": "init", "message": res.choices[0].message.content.strip()})

    profile = {
        "education": data.get("education"),
        "skills": data.get("skills", []),
        "interests": data.get("interests", []),
        "goal": data.get("goal"),
    }
    answers = data.get("answers", {})
    done = bool(data.get("done", False))
    last_user_message = data.get("query", "")

    if not done:
        messages = build_dynamic_question_prompt(profile, answers, last_user_message, mode)
        res = client.chat.completions.create(
            model="llama-3.1-8b-instant", messages=messages, temperature=0.4, max_tokens=120
        )
        return jsonify({"type": "question", "question": res.choices[0].message.content.strip()})

    messages = build_career_prompt(profile, answers, mode)
    res = client.chat.completions.create(
        model="llama-3.1-8b-instant", messages=messages, temperature=0.5, max_tokens=800
    )
    reply = res.choices[0].message.content.strip()

    return jsonify({"type": "career", "result": reply})

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")
    
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    print(f"🚀 Running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port)