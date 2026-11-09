"""FastAPI app: teacher API, pilot-lead API, public stats, and the built React app (single container deploy)."""
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .api import admin, growth, public, school_admin, teacher
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Shikshak Sahayak", version="0.1.0")
init_db()

if config.DEV_MODE:
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

app.include_router(teacher.router)
app.include_router(growth.router)
app.include_router(admin.router)
app.include_router(school_admin.router)
app.include_router(public.router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logging.getLogger("shikshak").exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)


# Serve the built SPA when present (production). In dev, Vite serves the UI and proxies API calls here.
if (config.FRONTEND_DIST / "index.html").exists():
    @app.middleware("http")
    async def html_navigation(request: Request, call_next):
        # /stats and /admin are both JSON APIs and SPA pages: a browser navigation (Accept: text/html) gets the app.
        if request.method == "GET" and "text/html" in request.headers.get("accept", "") \
                and not request.url.path.startswith(("/api/", "/assets/", "/docs", "/openapi")):
            return FileResponse(config.FRONTEND_DIST / "index.html")
        return await call_next(request)

    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str, request: Request):
        f = config.FRONTEND_DIST / path
        if path and f.is_file() and config.FRONTEND_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(config.FRONTEND_DIST / "index.html")
