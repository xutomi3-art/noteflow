"""Unit tests for query_router — SQL vs RAG routing logic."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from backend.services.query_router import route_query


class TestQueryRouter:
    async def test_no_schema_defaults_to_rag(self):
        assert await route_query("What is the summary?", schema=None) == "rag"

    async def test_empty_schema_defaults_to_rag(self):
        assert await route_query("How many rows?", schema="") == "rag"

    @patch("backend.services.query_router.qwen_client")
    async def test_sql_decision(self, mock_client):
        mock_client.generate = AsyncMock(return_value="sql")
        result = await route_query("How many products > 100?", schema="products(id INT, price DECIMAL)")
        assert result == "sql"

    @patch("backend.services.query_router.qwen_client")
    async def test_rag_decision(self, mock_client):
        mock_client.generate = AsyncMock(return_value="rag")
        result = await route_query("What about climate change?", schema="data(id INT, value TEXT)")
        assert result == "rag"

    @patch("backend.services.query_router.qwen_client")
    async def test_api_error_defaults_to_rag(self, mock_client):
        mock_client.generate = AsyncMock(side_effect=Exception("API timeout"))
        assert await route_query("Count rows", schema="table(id INT)") == "rag"

    @patch("backend.services.query_router.qwen_client")
    async def test_ambiguous_response_defaults_to_rag(self, mock_client):
        mock_client.generate = AsyncMock(return_value="I'm not sure, maybe both?")
        assert await route_query("Tell me about the data", schema="table(id INT)") == "rag"

    @patch("backend.services.query_router.qwen_client")
    async def test_sql_in_response_means_sql(self, mock_client):
        mock_client.generate = AsyncMock(return_value="I think sql would be best")
        assert await route_query("Sum of prices", schema="products(id INT, price DECIMAL)") == "sql"
