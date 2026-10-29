# Script to Hindi Story

A calm, bookish web application (Brown & White theme) that transforms video scripts and transcripts into flowing book-style Hindi (Devanagari) prose using the Google Gemini API.

The backend application logic is powered by **Python (Flask)**, with the frontend user interface crafted in clean **HTML & CSS**.

---

## Project Structure

```
c:\Users\sarve\Downloads\Search\
├── app.py                  # Main Python application (intelligent chunking, Gemini REST client, key rotation, SSE streaming)
├── sample_script.py        # 3,011-word historical sample script for acceptance testing
├── test_app.py             # 8 automated unit tests (chunking, key rotation, API endpoints)
├── requirements.txt        # Python dependencies (Flask, requests)
├── README.md               # Documentation and usage guide
├── .gitignore              # Standard Python gitignore
├── templates/
│   └── index.html          # Clean HTML interface (Brown & White reading theme)
└── static/
    ├── styles.css          # Palette-strict CSS with Noto Serif Devanagari typography
    └── app.js              # Browser client (localStorage persistence, SSE stream listener, copy & download)
```

---

## Core Features

1. **Python Backend Logic (`app.py`):**
   - **Intelligent Script Chunker (`split_script_into_chunks`):** Respects sentence and paragraph (`\n\n`) boundaries within a configurable limit (default: 12,000 characters) without breaking words.
   - **Multi-Key Round-Robin & Auto-Retry:** Uses up to 3 Gemini API keys round-robin. If a key returns `400` (invalid key), `429` (rate/quota limit), `5xx` (server error), or an empty response, the app automatically retries with the next key with a 1.2s delay (up to 2 complete passes over all keys).
   - **Context Chaining for Multi-Chunk Scripts:** For every chunk after the first, sends the last ~600 characters of the accumulated Hindi story as context, instructing Gemini to continue smoothly without duplicating content or adding section titles.
   - **Live Streaming via Server-Sent Events (SSE):** The `/api/generate_story` endpoint streams live progress updates and chunk outputs directly to the browser.

2. **Brown & White Theme UI (HTML & CSS):**
   - **Strict Color Palette:**
     - Espresso Brown `#3E2723` (headings, primary buttons)
     - Warm Brown `#6D4C41` (secondary text, borders, hover states)
     - Soft Tan `#D7C4B5` (dividers, input borders)
     - Cream White `#FAF6F1` (page background)
     - Pure White `#FFFFFF` (cards, textareas, reading panel)
   - **Typography:**
     - Hindi Story output: `Noto Serif Devanagari` (18.5px, line-height: 2.0, max-width: 70ch)
     - UI labels: `Hind` & system sans-serif
   - **Zero Emojis:** Calm, distraction-free reading aesthetic.

3. **Security & LocalStorage:**
   - API keys are never stored on a server; they remain exclusively in the user's browser `localStorage`.
   - Password fields feature visibility toggles ("Show / Hide").

4. **User Workflow & Utilities:**
   - **Stop Button:** Halt generation at any time; all paragraphs written so far are kept safe in the reading pane.
   - **Copy Story Button:** Copies the full generated story to clipboard with visual confirmation.
   - **Download (.txt) Button:** Downloads the entire story as a UTF-8 text file (`hindi_story.txt`).
   - **Load Sample Script Button:** Instantly loads a 3,011-word transcript for immediate testing.

---

## Core Rules for the AI Output (Default System Prompt)

1. Write only in Hindi (Devanagari). Do not skip any important event, fact, name, date or dialogue.
2. Remove speaker labels (Narrator:, Host:), timestamps, [music]/[applause] tags and any "role" labels.
3. No headings, subheadings, bullets or sections (no partitions). Only continuous paragraphs, like a book narrative.
4. Start exactly where the script starts and follow the same sequence. Remove repetition but keep the flow.
5. Do not add any introduction, conclusion, advice or commentary. Output only the story text.

---

## How to Run

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the Python Server
```bash
python app.py
```
The server will start at `http://127.0.0.1:5000`.

### 3. Open in Browser
Visit:
```
http://127.0.0.1:5000
```

---

## Running Automated Tests

Run the complete Python test suite anytime with:
```bash
python test_app.py
```
```
........
----------------------------------------------------------------------
Ran 8 tests in 0.118s

OK
```
