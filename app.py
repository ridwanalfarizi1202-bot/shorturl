import base64
import hashlib
import html
import os
import secrets
import sqlite3
from pathlib import Path
from urllib.parse import quote, urlparse

import streamlit as st

APP_DIR = Path(__file__).parent
DB_PATH = APP_DIR / "shorturl.db"
UPLOAD_DIR = APP_DIR / "uploads"
DEFAULT_BASE_URL = os.getenv("BASE_URL", "http://localhost:8501")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS links (
        code TEXT PRIMARY KEY,
        target_url TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        image_path TEXT,
        clicks INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    return conn


def valid_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def unique_code(conn) -> str:
    while True:
        code = secrets.token_urlsafe(5).replace("-", "").replace("_", "")[:7]
        if not conn.execute("SELECT 1 FROM links WHERE code = ?", (code,)).fetchone():
            return code


def save_image(uploaded_file, code: str) -> str | None:
    if not uploaded_file:
        return None
    allowed = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
    suffix = allowed.get(uploaded_file.type)
    if not suffix or uploaded_file.size > 5 * 1024 * 1024:
        raise ValueError("Foto harus JPG, PNG, WEBP, atau GIF; ukuran maksimal 5 MB.")
    UPLOAD_DIR.mkdir(exist_ok=True)
    path = UPLOAD_DIR / f"{code}{suffix}"
    path.write_bytes(uploaded_file.getvalue())
    return str(path.relative_to(APP_DIR))


def image_data_uri(path: str | None) -> str | None:
    if not path:
        return None
    file_path = APP_DIR / path
    if not file_path.exists():
        return None
    mime = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}.get(file_path.suffix, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(file_path.read_bytes()).decode()}"


def redirect_page(row):
    target = html.escape(row["target_url"], quote=True)
    st.markdown(f'<meta http-equiv="refresh" content="0;url={target}">', unsafe_allow_html=True)
    st.markdown(f'<script>window.location.replace({quote(row["target_url"])})</script>', unsafe_allow_html=True)
    st.info(f'Mengalihkan ke [{row["target_url"]}]({row["target_url"]})...')


st.set_page_config(page_title="Short URL", page_icon="🔗")
conn = db()
params = st.query_params
code = params.get("r")
if code:
    row = conn.execute("SELECT * FROM links WHERE code = ?", (code,)).fetchone()
    if row:
        conn.execute("UPDATE links SET clicks = clicks + 1 WHERE code = ?", (code,))
        conn.commit()
        redirect_page(row)
        st.stop()
    st.error("Short URL tidak ditemukan.")

st.title("🔗 Short URL")
st.caption("Buat link pendek dengan judul, deskripsi, dan foto OG preview.")

with st.form("create_link"):
    target_url = st.text_input("URL tujuan", placeholder="https://contoh.com/halaman")
    title = st.text_input("OG title", placeholder="Judul halaman")
    description = st.text_area("OG description", placeholder="Deskripsi singkat untuk preview")
    image = st.file_uploader("Foto OG preview", type=["jpg", "jpeg", "png", "webp", "gif"], help="Maksimal 5 MB")
    base_url = st.text_input("Base URL aplikasi", value=DEFAULT_BASE_URL, help="Isi URL Streamlit publik saat deploy.")
    submitted = st.form_submit_button("Buat short URL", type="primary")

if submitted:
    target_url = target_url.strip()
    base_url = base_url.strip().rstrip("/")
    if not valid_url(target_url):
        st.error("URL harus dimulai dengan http:// atau https://.")
    elif not valid_url(base_url):
        st.error("Base URL tidak valid.")
    else:
        try:
            new_code = unique_code(conn)
            image_path = save_image(image, new_code)
            conn.execute(
                "INSERT INTO links(code, target_url, title, description, image_path) VALUES (?, ?, ?, ?, ?)",
                (new_code, target_url, title.strip() or "Short URL", description.strip(), image_path),
            )
            conn.commit()
            short_url = f"{base_url}/?r={new_code}"
            st.success("Short URL berhasil dibuat.")
            st.code(short_url)
            st.warning("Streamlit cocok untuk MVP. OG crawler tertentu tidak membaca metadata dinamis dari Streamlit; produksi idealnya memakai endpoint server-side khusus preview.")
        except ValueError as exc:
            st.error(str(exc))

st.divider()
st.subheader("Link terbaru")
rows = conn.execute("SELECT * FROM links ORDER BY created_at DESC LIMIT 20").fetchall()
if rows:
    for row in rows:
        short_url = f"{DEFAULT_BASE_URL.rstrip('/')}/?r={row['code']}"
        with st.container(border=True):
            st.markdown(f"**{html.escape(row['title'])}** — {row['clicks']} klik")
            st.write(row["target_url"])
            st.code(short_url)
            if row["image_path"]:
                st.image(str(APP_DIR / row["image_path"]), width=240)
else:
    st.caption("Belum ada link.")

conn.close()
