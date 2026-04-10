"""PageIndex — tree-structured document indexing for RAG.

Vendored from https://github.com/VectifyAI/PageIndex with litellm replaced by our llm_client.
Only the markdown-to-tree pipeline is included (PDF TOC extraction not needed — MinerU handles that).
"""

from backend.services.pageindex.page_index_md import md_to_tree

__all__ = ["md_to_tree"]
