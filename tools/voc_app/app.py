"""고객 한마디 분류기 — 파일을 올리면 criteria.json 기준으로 규칙 분류한다.

    streamlit run tools/voc_app/app.py
"""
import pandas as pd
import streamlit as st

from classifier import (
    classify_table,
    guess_text_column,
    load_criteria,
    read_table,
    sheet_names,
    to_csv_bytes,
    to_excel_bytes,
)

st.set_page_config(page_title="고객 한마디 분류기", layout="wide")
st.title("고객 한마디 분류기")

criteria = load_criteria()  # 다시 그릴 때마다 읽어서, 기준을 고치면 바로 반영된다
st.caption(f"기준 version {criteria['version']} · {criteria['owner']}")
st.caption("규칙(낱말 목록)으로만 분류합니다. 올린 파일은 이 컴퓨터 안에서만 처리되고, AI로 보내지 않습니다.")

uploaded = st.file_uploader("CSV 또는 엑셀 파일을 올려 주세요", type=["csv", "xlsx"])
if uploaded is None:
    st.info("샘플 파일: tools/voc_app/sample/ 폴더의 sample_voc.csv · sample_voc.xlsx")
    st.stop()

data = uploaded.getvalue()
try:
    sheet = None
    if uploaded.name.lower().endswith(".xlsx"):
        names = sheet_names(data)
        sheet = st.selectbox("시트", names) if len(names) > 1 else names[0]
    table = read_table(data, uploaded.name, sheet)
except Exception as error:
    st.error(f"파일을 읽지 못했습니다: {error}")
    st.stop()

if table.empty or not len(table.columns):
    st.warning("파일에 데이터가 없습니다.")
    st.stop()

columns = list(table.columns)
column = st.selectbox(
    "고객 문장이 들어 있는 열",
    columns,
    index=columns.index(guess_text_column(columns, table)),
)

result = classify_table(table, column, criteria)

blank = int((table[column].str.strip() == "").sum())
if blank:
    st.warning(f"문장이 비어 있는 행 {blank}건은 «기타»로 분류됐습니다.")

st.subheader(f"요약 — 전체 {len(result)}건")
orders = {
    "분류": list(criteria["priority"]),
    "감정": ["부정", "중립", "긍정"],
    "긴급도": ["높음", "보통", "낮음"],
}
for container, (name, order) in zip(st.columns(3), orders.items()):
    counts = result[name].value_counts().reindex(order, fill_value=0)
    summary = pd.DataFrame({name: counts.index, "건수": counts.values})
    container.dataframe(summary, hide_index=True, width="stretch")

st.subheader("분류 결과")
filters = st.columns(3)
shown = result
for container, (name, order) in zip(filters, orders.items()):
    picked = container.multiselect(name, order, placeholder="전체")
    if picked:
        shown = shown[shown[name].isin(picked)]

st.caption(f"{len(shown)}건 표시")
st.dataframe(shown, hide_index=True, width="stretch", height=480)

stem = uploaded.name.rsplit(".", 1)[0]
left, right, _ = st.columns([1, 1, 4])
left.download_button(
    "CSV 내려받기",
    to_csv_bytes(shown),
    file_name=f"{stem}_분류결과.csv",
    mime="text/csv",
)
right.download_button(
    "엑셀 내려받기",
    to_excel_bytes(shown),
    file_name=f"{stem}_분류결과.xlsx",
    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)
