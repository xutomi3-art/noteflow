"""PageIndex utilities — vendored and adapted to use Noteflow's llm_client.

Original: https://github.com/VectifyAI/PageIndex/blob/main/pageindex/utils.py
Changes: litellm replaced with backend.services.llm_client, PDF-only functions removed.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re


# ---------------------------------------------------------------------------
# LLM wrappers (replace litellm with our llm_client)
# ---------------------------------------------------------------------------

def count_tokens(text: str, model: str | None = None) -> int:
    """Approximate token count. Used for tree node sizing — rough estimate is fine."""
    if not text:
        return 0
    # ~1.5 chars per token for mixed CJK/English
    return max(1, len(text) * 2 // 3)


def llm_completion(model: str | None, prompt: str, chat_history: list | None = None,
                   return_finish_reason: bool = False) -> str:
    """Synchronous LLM call — runs async generate in a new event loop."""
    from backend.services.llm_client import llm_client

    messages = list(chat_history or []) + [{"role": "user", "content": prompt}]
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = pool.submit(
                asyncio.run,
                llm_client.generate(messages, temperature=0.0, max_tokens=2048),
            ).result()
    else:
        result = asyncio.run(
            llm_client.generate(messages, temperature=0.0, max_tokens=2048)
        )

    if return_finish_reason:
        return result, "finished"
    return result


async def llm_acompletion(model: str | None, prompt: str) -> str:
    """Async LLM call — delegates to our llm_client.generate()."""
    from backend.services.llm_client import llm_client

    messages = [{"role": "user", "content": prompt}]
    return await llm_client.generate(messages, temperature=0.0, max_tokens=2048)


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def get_json_content(response: str) -> str:
    start_idx = response.find("```json")
    if start_idx != -1:
        response = response[start_idx + 7:]
    end_idx = response.rfind("```")
    if end_idx != -1:
        response = response[:end_idx]
    return response.strip()


def extract_json(content: str) -> dict | list:
    try:
        start_idx = content.find("```json")
        if start_idx != -1:
            json_content = content[start_idx + 7:]
            end_idx = json_content.rfind("```")
            if end_idx != -1:
                json_content = json_content[:end_idx]
        else:
            json_content = content.strip()

        json_content = json_content.replace('None', 'null')
        json_content = json_content.replace('\n', ' ').replace('\r', ' ')
        json_content = ' '.join(json_content.split())
        return json.loads(json_content)
    except json.JSONDecodeError:
        try:
            json_content = json_content.replace(',]', ']').replace(',}', '}')
            return json.loads(json_content)
        except Exception:
            logging.error("Failed to parse JSON even after cleanup")
            return {}
    except Exception as e:
        logging.error("Unexpected error while extracting JSON: %s", e)
        return {}


# ---------------------------------------------------------------------------
# Tree structure helpers
# ---------------------------------------------------------------------------

def write_node_id(data, node_id: int = 0) -> int:
    if isinstance(data, dict):
        data['node_id'] = str(node_id).zfill(4)
        node_id += 1
        for key in list(data.keys()):
            if 'nodes' in key:
                node_id = write_node_id(data[key], node_id)
    elif isinstance(data, list):
        for item in data:
            node_id = write_node_id(item, node_id)
    return node_id


def get_nodes(structure):
    if isinstance(structure, dict):
        node = copy.deepcopy(structure)
        node.pop('nodes', None)
        nodes = [node]
        for key in list(structure.keys()):
            if 'nodes' in key:
                nodes.extend(get_nodes(structure[key]))
        return nodes
    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(get_nodes(item))
        return nodes
    return []


def structure_to_list(structure):
    if isinstance(structure, dict):
        nodes = [structure]
        if 'nodes' in structure:
            nodes.extend(structure_to_list(structure['nodes']))
        return nodes
    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(structure_to_list(item))
        return nodes
    return []


def remove_structure_text(data):
    if isinstance(data, dict):
        data.pop('text', None)
        if 'nodes' in data:
            remove_structure_text(data['nodes'])
    elif isinstance(data, list):
        for item in data:
            remove_structure_text(item)
    return data


def remove_fields(data, fields=None):
    if fields is None:
        fields = ['text']
    if isinstance(data, dict):
        return {k: remove_fields(v, fields) for k, v in data.items() if k not in fields}
    elif isinstance(data, list):
        return [remove_fields(item, fields) for item in data]
    return data


def create_node_mapping(tree: list) -> dict:
    """Create a flat dict mapping node_id to node for quick lookup."""
    mapping = {}

    def _traverse(nodes):
        for node in nodes:
            if node.get('node_id'):
                mapping[node['node_id']] = node
            if node.get('nodes'):
                _traverse(node['nodes'])

    _traverse(tree)
    return mapping


# ---------------------------------------------------------------------------
# Summary generation
# ---------------------------------------------------------------------------

async def generate_node_summary(node: dict, model: str | None = None) -> str:
    prompt = (
        "You are given a part of a document, your task is to generate a brief description "
        "(30-100 words) of what main points are covered.\n\n"
        f"Partial Document Text: {node['text']}\n\n"
        "Directly return the description, do not include any other text."
    )
    return await llm_acompletion(model, prompt)


async def generate_summaries_for_structure(structure, model: str | None = None):
    nodes = structure_to_list(structure)
    tasks = [generate_node_summary(node, model=model) for node in nodes]
    summaries = await asyncio.gather(*tasks)
    for node, summary in zip(nodes, summaries):
        node['summary'] = summary
    return structure


def create_clean_structure_for_description(structure):
    if isinstance(structure, dict):
        clean_node = {}
        for key in ['title', 'node_id', 'summary', 'prefix_summary']:
            if key in structure:
                clean_node[key] = structure[key]
        if 'nodes' in structure and structure['nodes']:
            clean_node['nodes'] = create_clean_structure_for_description(structure['nodes'])
        return clean_node
    elif isinstance(structure, list):
        return [create_clean_structure_for_description(item) for item in structure]
    return structure


def generate_doc_description(structure, model: str | None = None) -> str:
    prompt = (
        "You are an expert in generating descriptions for a document. "
        "You are given a structure of a document. Your task is to generate a one-sentence "
        "description for the document, which makes it easy to distinguish the document from "
        "other documents.\n\n"
        f"Document Structure: {structure}\n\n"
        "Directly return the description, do not include any other text."
    )
    return llm_completion(model, prompt)


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def reorder_dict(data: dict, key_order: list) -> dict:
    if not key_order:
        return data
    return {key: data[key] for key in key_order if key in data}


def format_structure(structure, order=None):
    if not order:
        return structure
    if isinstance(structure, dict):
        if 'nodes' in structure:
            structure['nodes'] = format_structure(structure['nodes'], order)
        if not structure.get('nodes'):
            structure.pop('nodes', None)
        structure = reorder_dict(structure, order)
    elif isinstance(structure, list):
        structure = [format_structure(item, order) for item in structure]
    return structure


def print_toc(tree, indent=0):
    for node in tree:
        print('  ' * indent + node.get('title', ''))
        if node.get('nodes'):
            print_toc(node['nodes'], indent + 1)
