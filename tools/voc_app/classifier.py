"""rules.js 의 규칙 분류를 파이썬으로 옮긴 것 — 기준은 언제나 criteria.json 에서 읽는다."""
import io
import json
from pathlib import Path

import pandas as pd

CRITERIA_PATH = Path(__file__).resolve().parents[2] / "criteria.json"


def load_criteria(path=CRITERIA_PATH):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def hit(text, words):
    for word in words or []:
        if word in text:
            return word
    return None


def iga(word):
    """«앱»이 / «해지»가 — 받침에 맞는 조사."""
    c = ord(str(word).strip()[-1])
    if 0xAC00 <= c <= 0xD7A3:
        return "이" if (c - 0xAC00) % 28 else "가"
    return "이(가)"


def classify(text, criteria):
    t = "" if text is None else str(text)

    # 분류 — 우선순위대로 훑어서 처음 걸리는 것
    category = "기타"
    why_category = "어느 분류의 신호도 없어서 «기타»"
    keywords = {c["name"]: c["keywords"] for c in criteria["categories"]}
    for name in criteria["priority"]:
        word = hit(t, keywords.get(name))
        if word:
            category = name
            why_category = f"«{word}»{iga(word)} 있어서 «{name}»"
            break

    # 감정 — 부정 신호가 먼저
    neg = hit(t, criteria["sentiment"]["부정"])
    pos = hit(t, criteria["sentiment"]["긍정"])
    sentiment = "부정" if neg else "긍정" if pos else "중립"
    why_sentiment = f"«{neg or pos}»" if (neg or pos) else "신호 없음"

    # 긴급도 — 높음 신호가 먼저
    high = hit(t, criteria["urgency"]["높음"])
    low = hit(t, criteria["urgency"]["낮음"])
    urgency = "높음" if high else "낮음" if low else "보통"
    why_urgency = f"«{high or low}»" if (high or low) else "신호 없음"

    return {
        "분류": category,
        "감정": sentiment,
        "긴급도": urgency,
        "분류 근거": why_category,
        "감정 근거": why_sentiment,
        "긴급도 근거": why_urgency,
    }


def read_table(data, filename, sheet=None):
    """올린 파일의 바이트를 표로 읽는다. 값은 모두 글자로, 빈 칸은 빈 글자로."""
    if filename.lower().endswith(".csv"):
        for encoding in ("utf-8-sig", "cp949"):
            try:
                return pd.read_csv(io.BytesIO(data), encoding=encoding, dtype=str, keep_default_na=False)
            except UnicodeDecodeError:
                continue
        raise ValueError("CSV 글자 인코딩을 읽지 못했습니다. UTF-8 또는 CP949로 저장해 주세요.")
    return pd.read_excel(io.BytesIO(data), sheet_name=sheet or 0, dtype=str, keep_default_na=False)


def sheet_names(data):
    return pd.ExcelFile(io.BytesIO(data)).sheet_names


def guess_text_column(columns, table):
    """문장 열 이름을 짐작하고, 못 찾으면 글자가 가장 긴 열을 고른다."""
    for hint in ("고객 문장", "고객문장", "문장", "문의", "내용", "voc", "text"):
        for column in columns:
            if hint in str(column).lower():
                return column
    return max(columns, key=lambda c: table[c].astype(str).str.len().mean())


def classify_table(table, column, criteria):
    results = pd.DataFrame([classify(value, criteria) for value in table[column]], index=table.index)
    return pd.concat([table, results], axis=1)


def _safe_cell(value):
    """고객이 쓴 글이 엑셀에서 수식으로 실행되지 않게 한다."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
        return "'" + value
    return value


def _safe_table(table):
    return table.apply(lambda column: column.map(_safe_cell))


def to_csv_bytes(table):
    return _safe_table(table).to_csv(index=False).encode("utf-8-sig")


def to_excel_bytes(table):
    buffer = io.BytesIO()
    _safe_table(table).to_excel(buffer, index=False, sheet_name="분류 결과")
    return buffer.getvalue()
