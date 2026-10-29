import json
import re
import time
import requests
from flask import Flask, render_template, request, Response, jsonify
from sample_script import SAMPLE_SCRIPT

app = Flask(__name__)

DEFAULT_SYSTEM_PROMPT = """1. Write only in Hindi (Devanagari). Do not skip any important event, fact, name, date or dialogue.
2. Remove speaker labels (Narrator:, Host:), timestamps, [music]/[applause] tags and any "role" labels.
3. No headings, subheadings, bullets or sections (no partitions). Only continuous paragraphs, like a book narrative.
4. Start exactly where the script starts and follow the same sequence. Remove repetition but keep the flow.
5. Do not add any introduction, conclusion, advice or commentary. Output only the story text."""


def split_script_into_chunks(text: str, max_chunk_size: int = 12000) -> list[str]:
    """
    Intelligently splits long text into chunks up to max_chunk_size.
    Prioritizes paragraph breaks (\n\n), line breaks (\n), and sentence endings (। . ! ?).
    """
    if not text or not text.strip():
        return []
    
    normalized = text.strip()
    if len(normalized) <= max_chunk_size:
        return [normalized]

    chunks = []
    remaining = normalized

    while remaining:
        if len(remaining) <= max_chunk_size:
            chunks.append(remaining.strip())
            break

        min_threshold = int(max_chunk_size * 0.7)
        window = remaining[:max_chunk_size]
        cut_index = -1

        # 1. Paragraph break (\n\n)
        last_para = window.rfind('\n\n')
        if last_para >= min_threshold:
            cut_index = last_para

        # 2. Single newline (\n)
        if cut_index == -1:
            last_newline = window.rfind('\n')
            if last_newline >= min_threshold:
                cut_index = last_newline

        # 3. Sentence ending (. ! ? । followed by space or newline)
        if cut_index == -1:
            sentence_matches = list(re.finditer(r'[।\.!\?][\s\n]', window))
            for m in reversed(sentence_matches):
                if m.start() >= min_threshold:
                    cut_index = m.start() + 1
                    break

        # 4. Last space
        if cut_index == -1:
            last_space = window.rfind(' ')
            if last_space >= min_threshold:
                cut_index = last_space

        # 5. Hard slice fallback
        if cut_index <= 0:
            cut_index = max_chunk_size

        chunk = remaining[:cut_index].strip()
        if chunk:
            chunks.append(chunk)

        remaining = remaining[cut_index:].strip()

    return chunks


def call_gemini_api(model: str, api_key: str, system_instruction: str, user_prompt: str):
    """
    Direct REST call to Gemini generateContent endpoint.
    POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
    Header: x-goog-api-key
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key
    }
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "generationConfig": {
            "temperature": 0.3
        }
    }
    
    response = requests.post(url, headers=headers, json=payload, timeout=90)
    return response


def stream_story_generation(script_text: str, keys: list[dict], model: str, chunk_size: int, system_instruction: str):
    """
    Generator yielding Server-Sent Events (SSE) while processing chunks
    with multi-key round-robin rotation, 1.2s retries, and context chaining.
    """
    chunks = split_script_into_chunks(script_text, chunk_size)
    total_chunks = len(chunks)

    if total_chunks == 0:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Please enter a video script or transcript to convert.'}, ensure_ascii=False)}\n\n"
        return

    accumulated_story = ""
    active_key_index = 0
    max_passes = 2
    max_attempts_per_chunk = len(keys) * max_passes

    yield f"data: {json.dumps({'type': 'init', 'total_chunks': total_chunks}, ensure_ascii=False)}\n\n"

    for chunk_idx, chunk_text in enumerate(chunks):
        # Build prompt with context chaining for chunk > 0
        if chunk_idx == 0:
            user_prompt = (
                "Here is the first part of the original script. Please write it as a continuous book narrative "
                "purely in flowing Hindi (Devanagari) prose according to the rules, without headings, intro, or speaker labels:\n\n"
                f"---\n{chunk_text}\n---"
            )
        else:
            previous_context = accumulated_story.strip()[-600:].strip()
            user_prompt = (
                f'End of the previous installment (for context continuity only - do not repeat this, continue the story immediately from here):\n"...{previous_context}"\n\n'
                "Now here is the next part of the original script. Continue the story in flowing Hindi (Devanagari) prose "
                "strictly adhering to all rules without any headings, subheadings, partitions, intro, or repetition:\n\n"
                f"---\n{chunk_text}\n---"
            )

        chunk_success = False
        attempts = 0

        while attempts < max_attempts_per_chunk:
            key_info = keys[active_key_index % len(keys)]
            key_id = key_info["id"]
            api_key = key_info["key"]

            status_msg = f"Writing Part {chunk_idx + 1}/{total_chunks}... (Using API Key {key_id})"
            details_msg = f"Attempt {attempts + 1}/{max_attempts_per_chunk}" if attempts > 0 else ""
            percent = int((chunk_idx / total_chunks) * 100)

            yield f"data: {json.dumps({'type': 'status', 'text': status_msg, 'details': details_msg, 'percent': percent}, ensure_ascii=False)}\n\n"

            try:
                resp = call_gemini_api(model, api_key, system_instruction, user_prompt)
                
                # Check HTTP response
                if not resp.ok:
                    status_code = resp.status_code
                    err_msg = f"HTTP {status_code}"
                    try:
                        err_json = resp.json()
                        if "error" in err_json and "message" in err_json["error"]:
                            err_msg = f"{status_code} - {err_json['error']['message']}"
                    except Exception:
                        pass

                    attempts += 1
                    active_key_index = (active_key_index + 1) % len(keys)
                    next_key = keys[active_key_index % len(keys)]

                    if attempts < max_attempts_per_chunk:
                        retry_status = f"Key {key_id} failed ({err_msg}). Retrying with Key {next_key['id']}..."
                        yield f"data: {json.dumps({'type': 'status', 'text': retry_status, 'details': 'Waiting 1.2s...', 'percent': percent}, ensure_ascii=False)}\n\n"
                        time.sleep(1.2)
                        continue
                    else:
                        yield f"data: {json.dumps({'type': 'error', 'message': f'All API keys failed after 2 passes: {err_msg}'}, ensure_ascii=False)}\n\n"
                        return

                # Parse JSON
                data = resp.json()
                candidate = (data.get("candidates") or [{}])[0]
                content = candidate.get("content") or {}
                parts = content.get("parts") or [{}]
                generated_text = parts[0].get("text", "").strip()

                if not generated_text:
                    finish_reason = candidate.get("finishReason", "Unknown")
                    attempts += 1
                    active_key_index = (active_key_index + 1) % len(keys)
                    next_key = keys[active_key_index % len(keys)]

                    if attempts < max_attempts_per_chunk:
                        retry_status = f"Key {key_id} returned empty response ({finish_reason}). Retrying with Key {next_key['id']}..."
                        yield f"data: {json.dumps({'type': 'status', 'text': retry_status, 'details': 'Waiting 1.2s...', 'percent': percent}, ensure_ascii=False)}\n\n"
                        time.sleep(1.2)
                        continue
                    else:
                        yield f"data: {json.dumps({'type': 'error', 'message': 'API returned empty response (possibly blocked by safety filters).'}, ensure_ascii=False)}\n\n"
                        return

                # Successful chunk generation
                active_key_index = (active_key_index + 1) % len(keys)  # advance round-robin
                if accumulated_story:
                    accumulated_story += "\n\n" + generated_text
                else:
                    accumulated_story = generated_text

                chunk_percent = int(((chunk_idx + 1) / total_chunks) * 100)
                yield f"data: {json.dumps({'type': 'chunk', 'chunk_index': chunk_idx, 'text': generated_text, 'percent': chunk_percent}, ensure_ascii=False)}\n\n"
                chunk_success = True
                break

            except Exception as e:
                attempts += 1
                active_key_index = (active_key_index + 1) % len(keys)
                next_key = keys[active_key_index % len(keys)]

                if attempts < max_attempts_per_chunk:
                    retry_status = f"Key {key_id} connection failed ({str(e)}). Retrying with Key {next_key['id']}..."
                    yield f"data: {json.dumps({'type': 'status', 'text': retry_status, 'details': 'Waiting 1.2s...', 'percent': percent}, ensure_ascii=False)}\n\n"
                    time.sleep(1.2)
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'Connection failed on all API keys: {str(e)}'}, ensure_ascii=False)}\n\n"
                    return

        if not chunk_success:
            yield f"data: {json.dumps({'type': 'error', 'message': 'All available API keys exhausted or quota exceeded for this chunk.'}, ensure_ascii=False)}\n\n"
            return

    # Done
    yield f"data: {json.dumps({'type': 'done', 'total_chunks': total_chunks}, ensure_ascii=False)}\n\n"


# Routes
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sample_script", methods=["GET"])
def get_sample_script():
    return jsonify({"script": SAMPLE_SCRIPT})


@app.route("/api/generate_story", methods=["POST"])
def generate_story():
    payload = request.get_json() or {}
    script_text = (payload.get("script") or "").strip()
    raw_keys = payload.get("keys") or []
    model = payload.get("model") or "gemini-2.5-flash"
    chunk_size = int(payload.get("chunk_size") or 12000)
    system_prompt = (payload.get("system_prompt") or "").strip() or DEFAULT_SYSTEM_PROMPT

    # Filter non-empty keys
    valid_keys = []
    for item in raw_keys:
        k = (item.get("key") or "").strip()
        if k:
            valid_keys.append({"id": item.get("id", len(valid_keys) + 1), "key": k})

    if not valid_keys:
        return jsonify({"error": "Please enter at least one valid Gemini API key in Settings."}), 400

    if not script_text:
        return jsonify({"error": "Please enter a video script or transcript to convert."}), 400

    return Response(
        stream_story_generation(script_text, valid_keys, model, chunk_size, system_prompt),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


if __name__ == "__main__":
    print("Starting Script to Hindi Story on http://127.0.0.1:5000 ...")
    app.run(host="127.0.0.1", port=5000, debug=True)
