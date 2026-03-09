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


async def ingest_excel(source_id: uuid.UUID, file_path: str) -> str:
    """Load Excel/CSV into DuckDB, return the DuckDB file path as string."""
    duckdb_path = get_duckdb_path(source_id)
    path = Path(file_path)

    if path.suffix.lower() in ('.xlsx', '.xls'):
        df = pd.read_excel(file_path)
    else:  # .csv
        df = pd.read_csv(file_path)

    # Sanitize column names
    df.columns = [
        str(c).replace(' ', '_').replace('-', '_').lower()
        for c in df.columns
    ]

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
