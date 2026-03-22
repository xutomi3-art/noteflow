"""Unit tests for chat_service — context building and citation mapping logic."""
from __future__ import annotations

from backend.services.chat_service import (
    _build_context_prompt,
    _extract_page_from_content,
    _extract_page_from_positions,
)


class TestBuildContextPrompt:
    def test_empty_chunks(self):
        context, citations = _build_context_prompt([], {})
        assert context == ""
        assert citations == []

    def test_single_chunk_with_matching_source(self):
        chunks = [{"content_with_weight": "The quarterly revenue was $10M.", "document_keyword": "report.pdf"}]
        sources_map = {"source-1": {"filename": "report.pdf", "file_type": "pdf"}}
        context, citations = _build_context_prompt(chunks, sources_map)

        assert "quarterly revenue" in context
        assert len(citations) == 1
        assert citations[0]["index"] == 1
        assert citations[0]["source_id"] == "source-1"
        assert citations[0]["file_type"] == "pdf"

    def test_multiple_chunks_different_sources(self):
        chunks = [
            {"content_with_weight": "Sales data from Q1", "document_keyword": "sales.xlsx"},
            {"content_with_weight": "Meeting summary", "document_keyword": "notes.txt"},
        ]
        sources_map = {
            "s1": {"filename": "sales.xlsx", "file_type": "xlsx"},
            "s2": {"filename": "notes.txt", "file_type": "txt"},
        }
        context, citations = _build_context_prompt(chunks, sources_map)

        assert len(citations) == 2
        assert citations[0]["source_id"] == "s1"
        assert citations[1]["source_id"] == "s2"

    def test_ragflow_txt_to_md_renaming(self):
        chunks = [{"content_with_weight": "Some content", "document_keyword": "readme.md"}]
        sources_map = {"s1": {"filename": "readme.txt", "file_type": "txt"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["source_id"] == "s1"

    def test_ragflow_duplicate_suffix_stripping(self):
        chunks = [{"content_with_weight": "Dup content", "document_keyword": "report(2).pdf"}]
        sources_map = {"s1": {"filename": "report.pdf", "file_type": "pdf"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["source_id"] == "s1"

    def test_single_source_fallback(self):
        chunks = [{"content_with_weight": "Different name", "document_keyword": "ragflow_internal.md"}]
        sources_map = {"only-source": {"filename": "my_document.pdf", "file_type": "pdf"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["source_id"] == "only-source"

    def test_no_source_match_empty_id(self):
        chunks = [{"content_with_weight": "Unknown", "document_keyword": "mystery.pdf"}]
        sources_map = {
            "s1": {"filename": "report.xlsx", "file_type": "xlsx"},
            "s2": {"filename": "notes.docx", "file_type": "docx"},
        }
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["source_id"] == ""

    def test_excerpt_truncation(self):
        chunks = [{"content_with_weight": "A" * 500, "document_keyword": "doc.txt"}]
        sources_map = {"s1": {"filename": "doc.txt", "file_type": "txt"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert len(citations[0]["excerpt"]) == 300

    def test_fallback_content_field(self):
        chunks = [{"content": "Fallback content text", "document_keyword": "doc.txt"}]
        sources_map = {"s1": {"filename": "doc.txt", "file_type": "txt"}}
        context, _ = _build_context_prompt(chunks, sources_map)
        assert "Fallback content text" in context

    def test_version_pattern_matching(self):
        chunks = [{"content_with_weight": "Versioned", "document_keyword": "report_20250228v9_final.pdf"}]
        sources_map = {"s1": {"filename": "report_20250228v9.pdf", "file_type": "pdf"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["source_id"] == "s1"

    def test_page_from_injected_marker(self):
        """Chunks with <!-- page:N --> markers should extract correct page."""
        chunks = [{"content_with_weight": "<!-- page:7 -->\nFacilities CapEx table data", "document_keyword": "doc.md"}]
        sources_map = {"s1": {"filename": "doc.pdf", "file_type": "pdf"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["location"]["page"] == 7

    def test_page_from_positions_fallback(self):
        """Without page markers, falls back to RAGFlow positions."""
        chunks = [{"content_with_weight": "Some content", "document_keyword": "doc.md",
                    "positions": [[3, 100, 200, 300, 400]]}]
        sources_map = {"s1": {"filename": "doc.pdf", "file_type": "pdf"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["location"]["page"] == 3

    def test_no_page_info_empty_location(self):
        """Chunks without markers or positions have empty location."""
        chunks = [{"content_with_weight": "No page info", "document_keyword": "doc.md"}]
        sources_map = {"s1": {"filename": "doc.txt", "file_type": "txt"}}
        _, citations = _build_context_prompt(chunks, sources_map)
        assert citations[0]["location"] == {}


class TestExtractPageFromContent:
    def test_standard_marker(self):
        assert _extract_page_from_content("<!-- page:5 -->\nSome content") == 5

    def test_marker_with_spaces(self):
        assert _extract_page_from_content("<!--  page:12  -->\nContent") == 12

    def test_multiple_markers_uses_last(self):
        text = "<!-- page:3 -->\nFirst part\n<!-- page:4 -->\nSecond part"
        assert _extract_page_from_content(text) == 4

    def test_no_marker(self):
        assert _extract_page_from_content("Plain text without markers") is None

    def test_marker_in_html_table(self):
        text = "<!-- page:6 -->\n<table><tr><td>Data</td></tr></table>"
        assert _extract_page_from_content(text) == 6


class TestExtractPageFromPositions:
    def test_list_format(self):
        assert _extract_page_from_positions([[3, 100, 200, 300, 400]]) == 3

    def test_dict_format(self):
        assert _extract_page_from_positions([{"page": 5}]) == 5

    def test_empty(self):
        assert _extract_page_from_positions([]) is None

    def test_none(self):
        assert _extract_page_from_positions(None) is None
