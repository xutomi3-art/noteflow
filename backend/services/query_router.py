import logging
from backend.services.llm_client import llm_client

logger = logging.getLogger(__name__)

ROUTER_PROMPT = """You are a query router. Given a user question and an optional table schema, decide whether the question should be answered using:
A) SQL query against structured tabular data (Excel/CSV)
B) RAG semantic search against documents

Answer with ONLY "sql" or "rag" (lowercase, no punctuation, nothing else).

Table schema:
{schema}

Question: {question}"""


async def route_query(question: str, schema: str | None = None) -> str:
    """Returns 'sql' or 'rag'. Defaults to 'rag' if no schema or on error."""
    if not schema:
        return "rag"

    try:
        prompt = ROUTER_PROMPT.format(schema=schema, question=question)
        result = await llm_client.generate(
            [{"role": "user", "content": prompt}],
            max_tokens=10,
        )
        decision = result.strip().lower()
        logger.debug("Query router decision: %r for question: %r", decision, question[:80])
        return "sql" if "sql" in decision else "rag"
    except Exception as e:
        logger.warning("Query router failed, defaulting to rag: %s", e)
        return "rag"
