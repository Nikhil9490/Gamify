from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import openai, chromadb, pdfplumber, uuid, json, os, re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="PDF to Game - RAG Learning App")

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# In-memory session state
game_sessions = {}

STATIC_DIR = Path("./static")
STATIC_DIR.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")


# ─── Utility Functions ────────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF using pdfplumber."""
    import io
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def chunk_text(text: str, chunk_size: int = 400, overlap_sentences: int = 2) -> list:
    """
    Split text into chunks of ~400 tokens (1 token ~= 4 chars = ~1600 chars).
    Overlap by the last overlap_sentences sentences between chunks.
    """
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences = [s.strip() for s in sentences if s.strip()]

    target_chars = chunk_size * 4
    chunks = []
    current_sentences = []
    current_len = 0

    for sentence in sentences:
        current_sentences.append(sentence)
        current_len += len(sentence) + 1

        if current_len >= target_chars:
            chunk = " ".join(current_sentences)
            chunks.append(chunk)
            current_sentences = current_sentences[-overlap_sentences:] if overlap_sentences > 0 else []
            current_len = sum(len(s) + 1 for s in current_sentences)

    if current_sentences:
        chunk = " ".join(current_sentences)
        if chunk not in chunks:
            chunks.append(chunk)

    return chunks


def embed_texts(texts: list) -> list:
    """Embed a list of texts using text-embedding-3-small."""
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]


def detect_theme(text: str, user_theme: str = "auto") -> str:
    """Detect PDF theme or use user preference."""
    if user_theme in ("pirate", "space"):
        return user_theme

    text_lower = text.lower()
    space_keywords = [
        "space", "galaxy", "planet", "star", "orbit", "astronomy",
        "universe", "cosmos", "nasa", "rocket", "satellite", "quantum",
        "physics", "molecule", "atom", "chemistry", "biology", "science"
    ]
    score = sum(1 for kw in space_keywords if kw in text_lower)
    return "space" if score >= 3 else "pirate"


def extract_section_titles(text: str) -> list:
    """Try to extract section/chapter headings from text."""
    lines = text.split("\n")
    headings = []
    for line in lines:
        stripped = line.strip()
        if (5 < len(stripped) < 80
                and stripped == stripped.title()
                and not stripped.endswith(".")
                and len(stripped.split()) <= 8):
            headings.append(stripped)
    seen = set()
    unique = []
    for h in headings:
        if h not in seen:
            seen.add(h)
            unique.append(h)
    return unique


def generate_map_locations(theme: str, section_titles: list, pdf_topic: str) -> list:
    """Generate 5 themed location names using GPT."""
    titles_hint = ", ".join(section_titles[:10]) if section_titles else "general study material"

    system_prompt = (
        "You are a creative game designer. Generate exactly 5 location names for a "
        + ("pirate treasure hunt" if theme == "pirate" else "space exploration")
        + " game based on the provided study content sections. "
        "Return a valid JSON array of exactly 5 objects, each with 'name' and 'description' keys. "
        "Names should be themed but inspired by the actual content topics. "
        "Example pirate: [{\"name\": \"Skull Isle of Algebra\", \"description\": \"Where equations rule the seas\"}]"
    )

    user_prompt = (
        f"Study content sections: {titles_hint}\n"
        f"PDF topic: {pdf_topic[:200]}\n"
        f"Theme: {theme}\n"
        "Generate 5 location names. Return ONLY a JSON array."
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.8,
        max_tokens=500
    )

    raw = response.choices[0].message.content.strip()
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if match:
        try:
            locations = json.loads(match.group())
            return locations[:5]
        except json.JSONDecodeError:
            pass

    if theme == "pirate":
        return [
            {"name": "Skull Cove", "description": "The first challenge awaits"},
            {"name": "Treasure Bay", "description": "Secrets buried in the sand"},
            {"name": "Storm's Edge", "description": "Only the wise survive"},
            {"name": "Dragon's Den", "description": "Face the guardian"},
            {"name": "Golden Fortress", "description": "The final treasure awaits"},
        ]
    else:
        return [
            {"name": "Alpha Station", "description": "Begin your mission"},
            {"name": "Nebula Core", "description": "Mysteries of the cosmos"},
            {"name": "Void Crossing", "description": "Navigate the unknown"},
            {"name": "Quantum Reef", "description": "Reality bends here"},
            {"name": "Stellar Nexus", "description": "The final frontier"},
        ]


def retrieve_context(collection, query: str, n_results: int = 5) -> str:
    """Retrieve top-k relevant chunks from ChromaDB."""
    query_embedding = embed_texts([query])[0]
    count = collection.count()
    if count == 0:
        return ""
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, count)
    )
    docs = results.get("documents", [[]])[0]
    return "\n\n---\n\n".join(docs)


def generate_location_content(theme: str, location: dict, context: str, location_idx: int) -> dict:
    """Generate narrative + 3 questions for a location using retrieved context."""
    theme_flavor = (
        "pirate treasure hunt with nautical language, treasure maps, sea monsters, and adventure"
        if theme == "pirate"
        else "space exploration with starships, alien worlds, cosmic phenomena, and science fiction"
    )

    system_prompt = (
        "You are a game master running a " + theme_flavor + ". "
        "ONLY use information from the provided CONTEXT to create questions. "
        "Never invent facts, statistics, or claims not present in the context. "
        "If the context is insufficient for a question, base it on what IS present. "
        "All questions must be directly answerable from the context provided."
    )

    user_prompt = f"""
CONTEXT (study material):
{context}

---

LOCATION: {location['name']} - {location['description']}
LOCATION NUMBER: {location_idx + 1} of 5

Create an immersive game narrative (2-3 sentences) for this location that:
1. Uses {theme} theme flavor creatively
2. Naturally introduces the study topic from the context

Then create EXACTLY 3 multiple-choice questions based STRICTLY on the context above.
Each question must have options A, B, C, D with exactly one correct answer.

Return ONLY valid JSON in this exact format:
{{
  "narrative": "Your immersive narrative here...",
  "questions": [
    {{
      "question": "Question text?",
      "options": {{
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      }},
      "correct": "A",
      "explanation": "Brief explanation citing the source text"
    }},
    {{
      "question": "Second question?",
      "options": {{
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      }},
      "correct": "B",
      "explanation": "Brief explanation citing the source text"
    }},
    {{
      "question": "Third question?",
      "options": {{
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      }},
      "correct": "C",
      "explanation": "Brief explanation citing the source text"
    }}
  ]
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.7,
        max_tokens=1500,
        response_format={"type": "json_object"}
    )

    raw = response.choices[0].message.content.strip()
    return json.loads(raw)


# ─── API Endpoints ─────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), theme: str = "auto"):
    """Upload a PDF, process RAG pipeline, return game_id + theme + map structure."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        text = extract_text_from_pdf(file_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF text: {str(e)}")

    if len(text.strip()) < 100:
        raise HTTPException(status_code=400, detail="PDF appears to have no extractable text.")

    game_id = str(uuid.uuid4())
    detected_theme = detect_theme(text, theme)
    chunks = chunk_text(text)

    if not chunks:
        raise HTTPException(status_code=500, detail="Failed to chunk PDF text.")

    try:
        collection_name = f"game_{game_id.replace('-', '_')}"
        collection = chroma_client.create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}
        )

        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            embeddings = embed_texts(batch)
            collection.add(
                documents=batch,
                embeddings=embeddings,
                ids=[f"chunk_{i + j}" for j in range(len(batch))]
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index PDF: {str(e)}")

    section_titles = extract_section_titles(text)
    pdf_topic = text[:500]

    try:
        locations = generate_map_locations(detected_theme, section_titles, pdf_topic)
    except Exception as e:
        locations = [
            {"name": f"Location {i+1}", "description": "Study checkpoint"}
            for i in range(5)
        ]

    game_sessions[game_id] = {
        "game_id": game_id,
        "theme": detected_theme,
        "collection_name": collection_name,
        "locations": locations,
        "current_location": 0,
        "completed_locations": [],
        "scores": [],
        "total_correct": 0,
        "total_questions": 0,
        "location_data": {},
    }

    return JSONResponse({
        "game_id": game_id,
        "theme": detected_theme,
        "locations": locations,
        "total_chunks": len(chunks),
        "message": "PDF processed successfully. Your adventure begins!"
    })


@app.post("/start-location/{game_id}/{location_idx}")
async def start_location(game_id: str, location_idx: int):
    """Retrieve relevant context for this location and generate narrative + 3 questions."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]
    locations = session["locations"]

    if location_idx < 0 or location_idx >= len(locations):
        raise HTTPException(status_code=400, detail="Invalid location index.")

    if str(location_idx) in session["location_data"]:
        return JSONResponse(session["location_data"][str(location_idx)])

    location = locations[location_idx]
    collection_name = session["collection_name"]
    theme = session["theme"]

    try:
        collection = chroma_client.get_collection(collection_name)
        query = f"{location['name']} {location['description']}"
        context = retrieve_context(collection, query, n_results=5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve context: {str(e)}")

    try:
        content = generate_location_content(theme, location, context, location_idx)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate location content: {str(e)}")

    if "narrative" not in content or "questions" not in content:
        raise HTTPException(status_code=500, detail="Invalid content structure from AI.")

    questions = content["questions"][:3]
    content["questions"] = questions
    content["location_idx"] = location_idx
    content["location"] = location

    session["location_data"][str(location_idx)] = content
    return JSONResponse(content)


@app.post("/answer/{game_id}/{location_idx}/{question_idx}")
async def check_answer(game_id: str, location_idx: int, question_idx: int, answer: str):
    """Check a player's answer for a specific question."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]

    if str(location_idx) not in session["location_data"]:
        raise HTTPException(status_code=400, detail="Location not started yet.")

    location_data = session["location_data"][str(location_idx)]
    questions = location_data.get("questions", [])

    if question_idx < 0 or question_idx >= len(questions):
        raise HTTPException(status_code=400, detail="Invalid question index.")

    question = questions[question_idx]
    correct_answer = question["correct"].upper()
    player_answer = answer.upper().strip()
    is_correct = player_answer == correct_answer

    return JSONResponse({
        "is_correct": is_correct,
        "player_answer": player_answer,
        "correct_answer": correct_answer,
        "explanation": question.get("explanation", ""),
        "question": question["question"],
    })


@app.post("/complete-location/{game_id}/{location_idx}")
async def complete_location(game_id: str, location_idx: int, correct_count: int):
    """Mark a location as completed and update score."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]

    if location_idx not in session["completed_locations"]:
        session["completed_locations"].append(location_idx)
        session["scores"].append(correct_count)
        session["total_correct"] += correct_count
        session["total_questions"] += 3
        session["current_location"] = location_idx + 1

    game_complete = len(session["completed_locations"]) >= 5

    return JSONResponse({
        "location_completed": location_idx,
        "correct_count": correct_count,
        "total_correct": session["total_correct"],
        "total_questions": session["total_questions"],
        "game_complete": game_complete,
        "next_location": location_idx + 1 if not game_complete else None,
    })


@app.get("/game-state/{game_id}")
async def get_game_state(game_id: str):
    """Return the current game state for a session."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]
    return JSONResponse({
        "game_id": game_id,
        "theme": session["theme"],
        "locations": session["locations"],
        "current_location": session["current_location"],
        "completed_locations": session["completed_locations"],
        "scores": session["scores"],
        "total_correct": session["total_correct"],
        "total_questions": session["total_questions"],
        "game_complete": len(session["completed_locations"]) >= 5,
    })


@app.get("/")
async def root():
    """Redirect to the main app."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gamify_learning:app", host="0.0.0.0", port=8000, reload=True)
