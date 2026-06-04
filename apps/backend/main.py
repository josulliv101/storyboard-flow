import os
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables (checking local, frontend, and monorepo root paths)
load_dotenv()
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "web", ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

# Initialize FastAPI App
app = FastAPI(title="Storyboard AI Story Doctor Backend")

# Enable CORS for Next.js frontend calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Detect dependencies & configuration
HAS_GENAI_SDK = False
try:
    from google import genai
    from google.genai import types
    HAS_GENAI_SDK = True
except ImportError:
    pass

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Request/Response Schemas
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    report: Optional[Dict[str, Any]] = None
    script_text: Optional[str] = ""
    direct_ollama: Optional[bool] = False
    ollama_model: Optional[str] = "gemma"

class ActionPayload(BaseModel):
    type: str
    payload: Dict[str, Any]

class ChatResponse(BaseModel):
    reply: str
    actions: Optional[List[ActionPayload]] = None

# Gemini Tool Functions for Function Calling
def select_beat(index: int):
    """
    Selects or navigates the active view to a specific screenplay beat by its 1-based index (e.g. beat 1, beat 3, etc.).
    """
    return {"type": "SELECT_BEAT", "payload": {"index": index - 1}}

def go_to_highest_tension_beat():
    """
    Scans the timeline beats and jumps to the beat with the highest dramatic tension score.
    """
    return {"type": "SELECT_HIGHEST_METRIC", "payload": {"metric": "tension"}}

def seek_video_time(seconds: float):
    """
    Seeks the timeline video player to the specific time position in seconds.
    """
    return {"type": "SEEK_TIME", "payload": {"time": seconds}}

@app.get("/api/health")
async def health_check():
    """
    Diagnostics endpoint used by the frontend to confirm backend status, SDK, and key presence.
    """
    return {
        "status": "online",
        "has_genai_sdk": HAS_GENAI_SDK,
        "has_api_key": bool(GEMINI_API_KEY)
    }

@app.get("/api/ollama-status")
async def ollama_status():
    """
    Checks if Ollama is running locally and lists available models.
    """
    import http.client
    import json
    
    try:
        conn = http.client.HTTPConnection("127.0.0.1", 11434, timeout=1.5)
        conn.request("GET", "/api/tags")
        res = conn.getresponse()
        if res.status == 200:
            data = json.loads(res.read().decode())
            models = [m["name"] for m in data.get("models", [])]
            return {"status": "online", "models": models}
    except Exception:
        pass
    
    return {"status": "offline", "models": [], "error": "Ollama server unreachable"}

@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Conversational routing endpoint. If Gemini is available, uses function calling to detect timeline commands.
    """
    if not GEMINI_API_KEY or not HAS_GENAI_SDK:
        # Fallback offline responder when keys/SDK are missing
        reply = "Hello! Backend server is running, but GEMINI_API_KEY is not set in environment. Running in sandbox mode."
        return ChatResponse(reply=reply)

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Build contents structure for the Gemini API
        contents = []
        for msg in req.messages:
            contents.append(
                types.Content(
                    role="user" if msg.role == "user" else "model",
                    parts=[types.Part.from_text(text=msg.content)]
                )
            )

        # Contextual metadata block injected as system instruction
        system_instruction = (
            "You are the AI Story Doctor. You consult the user on their screenplay pacing, "
            "stakes, and tension. You have access to their active timeline beats and metrics.\n\n"
        )
        if req.report:
            system_instruction += f"Timeline Active Scene Report: {req.report}\n\n"
        if req.script_text:
            system_instruction += f"Dialogue Snippet Transcripts:\n{req.script_text}\n\n"
            
        system_instruction += (
            "IMPORTANT: If the user commands you to select, open, navigate to, or jump to a beat "
            "or a specific metric (e.g. 'go to beat 3', 'highest tension beat', 'seek to 10 seconds'), "
            "you MUST invoke the appropriate tool function. Do not try to solve it manually without a tool call."
        )

        # Call Gemini with Tools enabled
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[select_beat, go_to_highest_tension_beat, seek_video_time],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
            )
        )

        # Check for function/tool calls in response
        actions = []
        reply_content = response.text or ""
        
        # If there are function calls, collect them as action payloads
        if response.function_calls:
            for call in response.function_calls:
                if call.name == "select_beat":
                    idx = call.args.get("index", 1)
                    actions.append(ActionPayload(type="SELECT_BEAT", payload={"index": int(idx) - 1}))
                    if not reply_content:
                        reply_content = f"Selecting narrative Beat {idx} for you."
                elif call.name == "go_to_highest_tension_beat":
                    actions.append(ActionPayload(type="SELECT_HIGHEST_METRIC", payload={"metric": "tension"}))
                    if not reply_content:
                        reply_content = "Scrubbing timeline to the beat with the highest dramatic tension score."
                elif call.name == "seek_video_time":
                    secs = call.args.get("seconds", 0.0)
                    actions.append(ActionPayload(type="SEEK_TIME", payload={"time": float(secs)}))
                    if not reply_content:
                        reply_content = f"Jumping video playback to {secs} seconds."

        if not reply_content:
            reply_content = "Understood. Let me know if you would like me to navigate or review other parts of your timeline."

        return ChatResponse(reply=reply_content, actions=actions if actions else None)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
