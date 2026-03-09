import logging
import uuid
from pathlib import Path

import duckdb
import pandas as pd

logger = logging.getLogger(__name__)

DUCKDB_DIR = Path("/app/uploads/duckdb")


def get_duckdb_path(source_id: uuid.UUID) -> Path:
    DUCKDB_DIR.mkdir(parents=True, exist_ok=True)
    return DUCKDB_DIR / f"{source_id}.duckdb"


def _detect_header_row(df_raw: pd.DataFrame, max_scan: int = 20) -> int:
    """Detect the most likely header row in a raw DataFrame (loaded with header=None).

    Heuristic: the header row is the one with the most non-null string cells
    and the fewest numeric-looking cells. Scan up to max_scan rows.
    """
    best_row = 0
    best_score = -1

    scan_limit = min(max_scan, len(df_raw))
    for i in range(scan_limit):
        row = df_raw.iloc[i]
        non_null = row.notna().sum()
        str_cells = sum(
            1 for v in row
            if isinstance(v, str) and len(v.strip()) > 0 and not _is_number(v)
        )
        # Penalize rows that are mostly numbers (data rows, not headers)
        num_cells = sum(1 for v in row if _is_number(v))
        score = str_cells * 2 + non_null - num_cells * 3

        if score > best_score:
            best_score = score
            best_row = i

    return best_row


def _is_number(v) -> bool:
    """Check if a value looks like a number."""
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        try:
            float(v.replace(',', ''))
            return True
        except (ValueError, AttributeError):
            return False
    return False


async def ingest_excel(source_id: uuid.UUID, file_path: str) -> str:
    """Load Excel/CSV into DuckDB, return the DuckDB file path as string."""
    duckdb_path = get_duckdb_path(source_id)
    path = Path(file_path)

    # Step 1: Read without header to detect the real header row
    if path.suffix.lower() in ('.xlsx', '.xls'):
        df_raw = pd.read_excel(file_path, header=None)
    else:  # .csv
        df_raw = pd.read_csv(file_path, header=None)

    header_row = _detect_header_row(df_raw)
    logger.info("Detected header row at index %d for %s", header_row, path.name)

    # Step 2: Re-read with correct header, or slice the raw data
    if header_row == 0:
        # First row is header — normal case
        if path.suffix.lower() in ('.xlsx', '.xls'):
            df = pd.read_excel(file_path)
        else:
            df = pd.read_csv(file_path)
    else:
        # Use detected row as header, skip rows above it
        header_values = df_raw.iloc[header_row].tolist()
        df = df_raw.iloc[header_row + 1:].reset_index(drop=True)
        df.columns = header_values

    # Step 3: Clean up column names
    cleaned_cols = []
    seen = {}
    for c in df.columns:
        name = str(c).strip()
        # Skip unnamed/nan columns
        if name.lower() in ('nan', 'none', '') or name.startswith('unnamed'):
            name = f"col_{len(cleaned_cols)}"
        # Sanitize: spaces/hyphens to underscores, lowercase
        name = name.replace(' ', '_').replace('-', '_').replace('#', '_num').lower()
        # Deduplicate
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        cleaned_cols.append(name)
    df.columns = cleaned_cols

    # Step 4: Drop rows that are entirely empty
    df = df.dropna(how='all')

    # Step 5: Load into DuckDB
    con = duckdb.connect(str(duckdb_path))
    try:
        con.execute("DROP TABLE IF EXISTS data")
        con.execute("CREATE TABLE data AS SELECT * FROM df")
        row_count = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]
        schema = con.execute("DESCRIBE data").fetchdf().to_string()
        logger.info("Ingested %d rows into %s. Schema:\n%s", row_count, duckdb_path, schema)
    finally:
        con.close()

    return str(duckdb_path)


def query_excel(duckdb_path: str, sql: str) -> str:
    """Execute SQL against DuckDB and return formatted markdown result."""
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        result = con.execute(sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        if not rows:
            return "Query returned no results."
        # Build markdown table manually to avoid pandas issues with complex types
        header = "| " + " | ".join(columns) + " |"
        separator = "| " + " | ".join("---" for _ in columns) + " |"
        body_lines = []
        for row in rows:
            cells = [str(v) for v in row]
            body_lines.append("| " + " | ".join(cells) + " |")
        return "\n".join([header, separator] + body_lines)
    finally:
        con.close()


def get_table_schema(duckdb_path: str) -> str:
    """Return schema description for the data table."""
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        schema_df = con.execute("DESCRIBE data").fetchdf()
        return schema_df.to_string(index=False)
    finally:
        con.close()


def get_table_sample(duckdb_path: str, head: int = 3, tail: int = 3) -> str:
    """Return sample rows (first N + last N) to help LLM understand data structure."""
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        total = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]
        columns = [d[0] for d in con.execute("DESCRIBE data").fetchall()]
        header = "| " + " | ".join(columns) + " |"
        separator = "| " + " | ".join("---" for _ in columns) + " |"

        if total <= head + tail:
            rows = con.execute("SELECT * FROM data").fetchall()
            lines = [header, separator]
            for i, r in enumerate(rows):
                lines.append(f"| " + " | ".join(str(v) for v in r) + f" | (row {i+1})")
        else:
            head_rows = con.execute(f"SELECT * FROM data LIMIT {head}").fetchall()
            tail_rows = con.execute(f"SELECT * FROM data OFFSET {total - tail}").fetchall()
            lines = [header, separator]
            for i, r in enumerate(head_rows):
                lines.append(f"| " + " | ".join(str(v) for v in r) + f" | (row {i+1})")
            lines.append(f"| ... ({total - head - tail} more rows) ... |")
            for i, r in enumerate(tail_rows):
                lines.append(f"| " + " | ".join(str(v) for v in r) + f" | (row {total - tail + i + 1})")

        return "\n".join(lines)
    finally:
        con.close()
