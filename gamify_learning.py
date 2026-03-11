from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import openai, chromadb, pdfplumber, uuid, json, os, re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Chef's Kitchen — RAG Learning App")

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# In-memory session state
game_sessions = {}

STATIC_DIR = Path("./static")
STATIC_DIR.mkdir(exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")


# ─── Utility Functions ────────────────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> tuple:
    """Extract text per page. Returns (full_text, list of (page_num, page_text))."""
    import io
    full_parts = []
    page_texts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text()
            if page_text and page_text.strip():
                full_parts.append(page_text)
                page_texts.append((i + 1, page_text))
    return "\n".join(full_parts), page_texts


def chunk_text(page_texts: list, chunk_size: int = 400, overlap_sentences: int = 2) -> list:
    """
    Split page-level texts into chunks of ~400 tokens.
    Returns list of dicts: {text, page}.
    """
    target_chars = chunk_size * 4
    chunks = []

    for page_num, page_text in page_texts:
        sentences = re.split(r'(?<=[.!?])\s+', page_text.strip())
        sentences = [s.strip() for s in sentences if s.strip()]

        current_sentences = []
        current_len = 0

        for sentence in sentences:
            current_sentences.append(sentence)
            current_len += len(sentence) + 1

            if current_len >= target_chars:
                chunk_txt = " ".join(current_sentences)
                chunks.append({"text": chunk_txt, "page": page_num})
                current_sentences = current_sentences[-overlap_sentences:] if overlap_sentences > 0 else []
                current_len = sum(len(s) + 1 for s in current_sentences)

        if current_sentences:
            chunk_txt = " ".join(current_sentences)
            if not chunks or chunks[-1]["text"] != chunk_txt:
                chunks.append({"text": chunk_txt, "page": page_num})

    return chunks


def embed_texts(texts: list) -> list:
    """Embed a list of texts using text-embedding-3-small."""
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]


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


def generate_map_locations(section_titles: list, pdf_topic: str) -> list:
    """Generate 5 chef/kitchen-themed location names using GPT, grounded in PDF content."""
    titles_hint = ", ".join(section_titles[:10]) if section_titles else "general study material"

    system_prompt = (
        "You are a creative culinary game designer. Generate exactly 5 kitchen station names "
        "for a chef cooking game based on the provided study content sections. "
        "Each station should metaphorically represent a stage of mastering the study material "
        "through the lens of cooking — from raw ingredients to a finished dish. "
        "The station names must be inspired by the actual PDF section titles provided. "
        "Return a valid JSON array of exactly 5 objects, each with 'name' and 'description' keys. "
        "Example: [{\"name\": \"The Pantry of Foundations\", \"description\": \"Where raw knowledge awaits — gather your ingredients\"}]"
    )

    user_prompt = (
        f"Study content sections: {titles_hint}\n"
        f"PDF topic (first 200 chars): {pdf_topic[:200]}\n"
        "Generate 5 kitchen station names inspired by these sections. "
        "Stations should progress from foundational (pantry, prep) to advanced (stove, oven, plating). "
        "Return ONLY a JSON array."
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

    # Fallback stations
    return [
        {"name": "The Pantry", "description": "Gather your foundational ingredients"},
        {"name": "Prep Station", "description": "Mise en place — understanding the concepts"},
        {"name": "The Stove", "description": "Apply heat and transform knowledge"},
        {"name": "The Oven", "description": "Patience and deeper analysis"},
        {"name": "Plating", "description": "Present your mastery to the world"},
    ]


def retrieve_context(collection, query: str, n_results: int = 5) -> str:
    """Retrieve top-k relevant chunks from ChromaDB, annotated with page numbers."""
    query_embedding = embed_texts([query])[0]
    count = collection.count()
    if count == 0:
        return ""
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, count),
        include=["documents", "metadatas"]
    )
    docs = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    parts = []
    for i, (doc, meta) in enumerate(zip(docs, metadatas)):
        page = meta.get("page", "?") if meta else "?"
        parts.append(f"[SOURCE {i + 1}, Page {page}]:\n{doc}")
    return "\n\n---\n\n".join(parts)


def generate_location_content(location: dict, context: str, location_idx: int) -> dict:
    """Generate narrative + 5 questions for a kitchen station using retrieved context."""

    system_prompt = (
        "You are a head chef running a culinary school with a cooking game theme. "
        "Use the voice of an encouraging but demanding chef instructor. "
        "ONLY use information from the provided CONTEXT to create questions. "
        "Never invent facts, statistics, or claims not present in the context. "
        "If the context is insufficient for a question, base it on what IS present. "
        "All questions must be directly answerable from the context provided. "
        "For each question, include a short verbatim quote (1-2 sentences max) from the context "
        "that directly supports the correct answer, and the page number from the [SOURCE N, Page X] label."
    )

    user_prompt = f"""
CONTEXT (study material):
{context}

---

KITCHEN STATION: {location['name']} — {location['description']}
COURSE NUMBER: {location_idx + 1} of 5

Create an immersive chef/cooking narrative (2-3 sentences) for this kitchen station that:
1. Uses culinary/cooking metaphors and chef language creatively
2. Naturally introduces the study topic from the context
3. Sets the scene as if a chef is briefing their kitchen brigade

Then create EXACTLY 5 multiple-choice questions based STRICTLY on the context above.
Each question must have options A, B, C, D with exactly one correct answer.

Return ONLY valid JSON in this exact format:
{{
  "narrative": "Your immersive chef narrative here...",
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
      "explanation": "Brief explanation citing the source text",
      "source_quote": "Verbatim quote from the context supporting the answer",
      "source_page": 1
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
      "explanation": "Brief explanation citing the source text",
      "source_quote": "Verbatim quote from the context supporting the answer",
      "source_page": 2
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
      "explanation": "Brief explanation citing the source text",
      "source_quote": "Verbatim quote from the context supporting the answer",
      "source_page": 3
    }},
    {{
      "question": "Fourth question?",
      "options": {{
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      }},
      "correct": "D",
      "explanation": "Brief explanation citing the source text",
      "source_quote": "Verbatim quote from the context supporting the answer",
      "source_page": 4
    }},
    {{
      "question": "Fifth question?",
      "options": {{
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      }},
      "correct": "A",
      "explanation": "Brief explanation citing the source text",
      "source_quote": "Verbatim quote from the context supporting the answer",
      "source_page": 1
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
        max_tokens=2500,
        response_format={"type": "json_object"}
    )

    raw = response.choices[0].message.content.strip()
    return json.loads(raw)


# ─── API Endpoints ─────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF, process RAG pipeline, return game_id + map structure."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        text, page_texts = extract_text_from_pdf(file_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF text: {str(e)}")

    if len(text.strip()) < 100:
        raise HTTPException(status_code=400, detail="PDF appears to have no extractable text.")

    game_id = str(uuid.uuid4())
    chunks = chunk_text(page_texts)

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
            texts_only = [c["text"] for c in batch]
            embeddings = embed_texts(texts_only)
            collection.add(
                documents=texts_only,
                embeddings=embeddings,
                ids=[f"chunk_{i + j}" for j in range(len(batch))],
                metadatas=[{"page": c["page"]} for c in batch]
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index PDF: {str(e)}")

    section_titles = extract_section_titles(text)
    pdf_topic = text[:500]

    try:
        locations = generate_map_locations(section_titles, pdf_topic)
    except Exception as e:
        locations = [
            {"name": f"Station {i+1}", "description": "Kitchen checkpoint"}
            for i in range(5)
        ]

    game_sessions[game_id] = {
        "game_id": game_id,
        "theme": "chef",
        "collection_name": collection_name,
        "locations": locations,
        "current_location": 0,
        "completed_locations": [],
        "scores": [],
        "burnt_locations": [],
        "total_correct": 0,
        "total_questions": 0,
        "location_data": {},
    }

    return JSONResponse({
        "game_id": game_id,
        "theme": "chef",
        "locations": locations,
        "total_chunks": len(chunks),
        "message": "PDF processed successfully. Your kitchen is ready, Chef!"
    })


@app.post("/start-location/{game_id}/{location_idx}")
async def start_location(game_id: str, location_idx: int):
    """Retrieve relevant context for this station and generate narrative + 5 questions."""
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

    try:
        collection = chroma_client.get_collection(collection_name)
        query = f"{location['name']} {location['description']}"
        context = retrieve_context(collection, query, n_results=5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve context: {str(e)}")

    try:
        content = generate_location_content(location, context, location_idx)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate location content: {str(e)}")

    if "narrative" not in content or "questions" not in content:
        raise HTTPException(status_code=500, detail="Invalid content structure from AI.")

    questions = content["questions"][:5]
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
        "source_quote": question.get("source_quote", ""),
        "source_page": question.get("source_page", None),
    })


@app.post("/complete-location/{game_id}/{location_idx}")
async def complete_location(game_id: str, location_idx: int, correct_count: int, burnt: bool = False):
    """Mark a station as completed and update score."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]

    if location_idx not in session["completed_locations"]:
        session["completed_locations"].append(location_idx)
        session["scores"].append(correct_count)
        session["total_correct"] += correct_count
        session["total_questions"] += 5
        session["current_location"] = location_idx + 1
        if burnt:
            session["burnt_locations"].append(location_idx)

    game_complete = len(session["completed_locations"]) >= 5

    return JSONResponse({
        "location_completed": location_idx,
        "correct_count": correct_count,
        "total_correct": session["total_correct"],
        "total_questions": session["total_questions"],
        "game_complete": game_complete,
        "next_location": location_idx + 1 if not game_complete else None,
        "burnt": burnt,
    })


@app.get("/game-state/{game_id}")
async def get_game_state(game_id: str):
    """Return the current game state for a session."""
    if game_id not in game_sessions:
        raise HTTPException(status_code=404, detail="Game session not found.")

    session = game_sessions[game_id]
    return JSONResponse({
        "game_id": game_id,
        "theme": "chef",
        "locations": session["locations"],
        "current_location": session["current_location"],
        "completed_locations": session["completed_locations"],
        "scores": session["scores"],
        "burnt_locations": session.get("burnt_locations", []),
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
