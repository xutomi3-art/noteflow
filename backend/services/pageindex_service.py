"""PageIndex service — tree-structured document indexing and retrieval.

Builds hierarchical tree indexes from parsed markdown and provides
tree-guided retrieval for chat Q&A and skill context.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.database import async_session
from backend.models.source import Source
from backend.services.source_service import update_source_status

logger = logging.getLogger(__name__)


async def build_page_index_tree(parsed_md_path: str) -> dict | None:
    """Build a PageIndex tree from a parsed markdown file.

    Args:
        parsed_md_path: Path to the _parsed.md file (already exists from MinerU).

    Returns:
        Tree dict with doc_name, line_count, structure (list of nodes).
        Each node has: title, node_id, line_num, summary/prefix_summary, text, nodes.
    """
    from backend.services.pageindex import md_to_tree

    try:
        # Step 1: Build tree structure only (no LLM calls yet)
        tree = await md_to_tree(
            parsed_md_path,
            if_add_node_summary='no',
            if_add_node_text='yes',
            if_add_node_id='yes',
        )
        if not tree or not tree.get('structure'):
            logger.warning("PageIndex returned empty tree for %s", parsed_md_path)
            return None

        node_count = _count_nodes(tree['structure'])
        top_level = len(tree['structure'])
        quality = assess_tree_quality(tree['structure'], node_count, top_level)
        tree['_quality'] = quality

        # Step 2: Only generate summaries if tree is usable (saves LLM calls)
        if quality == 'skip':
            logger.info("PageIndex skip: %d nodes (< 3), no summaries generated for %s",
                         node_count, parsed_md_path)
            return tree

        # Rebuild with summaries for usable trees
        tree = await md_to_tree(
            parsed_md_path,
            if_add_node_summary='yes',
            summary_token_threshold=200,
            if_add_node_text='yes',
            if_add_node_id='yes',
        )
        tree['_quality'] = quality

        logger.info("PageIndex tree built: %d nodes, %d top-level, quality=%s from %s",
                     node_count, top_level, quality, parsed_md_path)
        return tree
    except Exception as e:
        logger.error("PageIndex tree build failed for %s: %s", parsed_md_path, e)
        return None


def assess_tree_quality(structure: list, node_count: int, top_level: int) -> str:
    """Auto-assess tree quality based on structural depth.

    Universal rule: a tree is only useful for navigation when it has at least
    3 levels of hierarchy (# → ## → ###). This indicates the document has
    real topical structure, not just a flat list of headings.

    Returns:
        "full"         — ≥3 levels deep, use for tree-guided retrieval + skills
        "summary_only" — has nodes but <3 levels, use node summaries for skills only
        "skip"         — tree has no value, fall back to digest/RAG
    """
    if node_count < 3:
        return "skip"

    depth = _get_max_depth(structure)
    if depth >= 3:
        return "full"
    return "summary_only"


def _get_max_depth(nodes: list, current_depth: int = 1) -> int:
    """Get the maximum depth of a tree structure."""
    max_d = current_depth
    for node in nodes:
        if node.get('nodes'):
            child_depth = _get_max_depth(node['nodes'], current_depth + 1)
            if child_depth > max_d:
                max_d = child_depth
    return max_d


async def store_page_index_tree(source_id: uuid.UUID, tree: dict) -> None:
    """Store a built tree into the Source.page_index_tree JSONB column."""
    async with async_session() as db:
        await update_source_status(db, source_id, page_index_tree=tree)


async def get_relevant_sections(
    notebook_id: uuid.UUID,
    query: str,
    source_ids: list[str] | None = None,
) -> str:
    """Tree-guided retrieval: LLM reads tree outline → identifies relevant sections → returns text.

    Single LLM call approach (~1-2s overhead).

    Args:
        notebook_id: Notebook to search in.
        query: User question.
        source_ids: Optional filter to specific sources.

    Returns:
        Concatenated section text from relevant tree nodes, or empty string.
    """
    from backend.services.llm_client import llm_client

    async with async_session() as db:
        stmt = select(Source).where(
            Source.notebook_id == notebook_id,
            Source.page_index_tree.isnot(None),
            Source.status == "ready",
        )
        if source_ids:
            stmt = stmt.where(Source.id.in_([uuid.UUID(s) for s in source_ids]))
        result = await db.execute(stmt)
        all_sources = list(result.scalars().all())

    # Only use sources with quality="full" for tree-guided retrieval
    sources = [s for s in all_sources if _get_tree_quality(s) == 'full']
    if not sources:
        return ""

    # Build compact table-of-contents from qualified trees only
    toc = _build_compact_toc(sources)
    if not toc:
        return ""

    # Single LLM call to identify relevant sections
    prompt = (
        f'Given these document outlines, identify the 3-5 most relevant sections '
        f'to answer: "{query}"\n\n'
        f'Return ONLY the node_ids (comma-separated, max 5), e.g.: 0002,0003,0007\n'
        f'Pick the most specific leaf nodes, not broad parent sections.\n'
        f'If no section is relevant, return: NONE\n\n'
        f'{toc}'
    )

    node_ids_str = await llm_client.generate(
        [{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=100,
    )

    if not node_ids_str or "NONE" in node_ids_str.upper():
        return ""

    # Extract text from identified nodes (max 5 nodes, max 10000 chars total)
    node_ids = [nid.strip() for nid in node_ids_str.split(",") if nid.strip()][:5]
    return _extract_node_texts(sources, node_ids)


def _get_tree_quality(source: Source) -> str:
    """Get tree quality for a source, computing it if missing (for old trees)."""
    tree = source.page_index_tree
    if not tree or not tree.get('structure'):
        return 'skip'
    quality = tree.get('_quality')
    if quality:
        return quality
    # Compute for old trees without _quality tag
    node_count = _count_nodes(tree['structure'])
    top_level = len(tree['structure'])
    return assess_tree_quality(tree['structure'], node_count, top_level)


def get_tree_context_for_skills(sources: list[Source]) -> str:
    """Build skill context from tree node summaries.

    Only uses sources with quality != 'skip' (at least 3 nodes).
    Formats trees as structured outlines for skill generation.

    Args:
        sources: List of Source objects with page_index_tree populated.

    Returns:
        Formatted outline string.
    """
    parts = []
    for source in sources:
        quality = _get_tree_quality(source)
        if quality == 'skip':
            continue  # < 3 nodes — tree has no value for skills
        tree = source.page_index_tree
        if not tree or not tree.get('structure'):
            continue
        parts.append(f"--- {source.filename} ---")
        if quality == 'summary_only':
            # Too many nodes — only use top-level summaries, don't recurse
            parts.append(_format_tree_outline(tree['structure'], include_text=False, max_depth=1))
        else:
            parts.append(_format_tree_outline(tree['structure'], include_text=False))
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _count_nodes(structure: list) -> int:
    count = 0
    for node in structure:
        count += 1
        if node.get('nodes'):
            count += _count_nodes(node['nodes'])
    return count


def _build_compact_toc(sources: list[Source]) -> str:
    """Build a compact table-of-contents from all source trees.

    Format:
    [Source: filename.pdf]
    0001 Section Title — Summary text here...
      0002 Subsection — More details...
    """
    parts = []
    for source in sources:
        tree = source.page_index_tree
        if not tree or not tree.get('structure'):
            continue
        parts.append(f"[Source: {source.filename}]")
        parts.append(_format_toc_nodes(tree['structure'], indent=0))
    return "\n".join(parts)


def _format_toc_nodes(nodes: list, indent: int = 0) -> str:
    lines = []
    for node in nodes:
        prefix = "  " * indent
        node_id = node.get('node_id', '????')
        title = node.get('title', '')
        summary = node.get('summary', node.get('prefix_summary', ''))
        if summary:
            summary = summary[:120]
            lines.append(f"{prefix}{node_id} {title} — {summary}")
        else:
            lines.append(f"{prefix}{node_id} {title}")
        if node.get('nodes'):
            lines.append(_format_toc_nodes(node['nodes'], indent + 1))
    return "\n".join(lines)


MAX_NODE_TEXT_CHARS = 1500  # Per-node cap: if text exceeds this, use summary instead


def _extract_node_texts(sources: list[Source], node_ids: list[str]) -> str:
    """Extract text from tree nodes matching the given node_ids.

    If a node's text is too long (parent node selected instead of leaf),
    fall back to its summary to avoid context bloat.
    """
    node_id_set = set(node_ids)
    parts = []

    for source in sources:
        tree = source.page_index_tree
        if not tree or not tree.get('structure'):
            continue
        matched = _find_nodes_by_ids(tree['structure'], node_id_set)
        for node in matched:
            title = node.get('title', '')
            text = node.get('text', '')

            if not text:
                continue

            if len(text) > MAX_NODE_TEXT_CHARS:
                # Node too large (probably a parent node) — use summary + first part of text
                summary = node.get('summary', node.get('prefix_summary', ''))
                if summary:
                    section = f"[{source.filename}: {title}]\nSummary: {summary}\n\n{text[:MAX_NODE_TEXT_CHARS]}..."
                else:
                    section = f"[{source.filename}: {title}]\n{text[:MAX_NODE_TEXT_CHARS]}..."
                logger.info("PageIndex node %s text too long (%d chars), using summary + truncated",
                            node.get('node_id', '?'), len(text))
            else:
                section = f"[{source.filename}: {title}]\n{text}"

            parts.append(section)

    return "\n\n---\n\n".join(parts)


def _find_nodes_by_ids(nodes: list, node_ids: set) -> list:
    """Recursively find all nodes matching the given node_ids."""
    matched = []
    for node in nodes:
        if node.get('node_id') in node_ids:
            matched.append(node)
        if node.get('nodes'):
            matched.extend(_find_nodes_by_ids(node['nodes'], node_ids))
    return matched


def _format_tree_outline(nodes: list, indent: int = 0, include_text: bool = False, max_depth: int | None = None) -> str:
    """Format tree as markdown outline for skill context.

    Args:
        max_depth: If set, stop recursing after this many levels (1 = top-level only).
    """
    lines = []
    for node in nodes:
        prefix = "#" * (indent + 1)
        title = node.get('title', '')
        lines.append(f"{prefix} {title}")
        summary = node.get('summary', node.get('prefix_summary', ''))
        if summary:
            lines.append(f"Summary: {summary}")
        if include_text and node.get('text'):
            lines.append(node['text'][:500])
        if node.get('nodes') and (max_depth is None or indent + 1 < max_depth):
            lines.append(_format_tree_outline(node['nodes'], indent + 1, include_text, max_depth))
    return "\n".join(lines)
