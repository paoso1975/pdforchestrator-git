from __future__ import annotations

import time
import math
import re
import hashlib
import json
from pathlib import Path
from typing import Any, Callable

from pypdf import PdfWriter
from .tools import ToolContext, ToolError, ToolRegistry, ToolResult

_LOOP_TYPES = {"loop.eachPage", "loop.forEach", "loop.while", "loop.repeatUntil"}
_TRANSFER_TYPES = {"flow.break": "break", "flow.continue": "continue", "flow.jumpPage": "jumpPage"}


def _js_number(value: float) -> str:
    if not math.isfinite(value): raise ValueError("non-finite number")
    if value == 0: return "0"
    negative = value < 0
    raw = repr(abs(value)).lower()
    from decimal import Decimal
    decimal = Decimal(raw)
    magnitude = abs(value)
    if 1e-6 <= magnitude < 1e21:
        fixed = format(decimal, "f")
        if "." in fixed: fixed = fixed.rstrip("0").rstrip(".")
        return ("-" if negative else "") + fixed
    if "e" not in raw:
        raw = format(decimal.normalize(), "e")
    mantissa, exponent = raw.split("e", 1)
    mantissa = mantissa.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    return ("-" if negative else "") + mantissa + "e" + ("+" if exponent_value >= 0 else "-") + str(abs(exponent_value))


def _stable_json(value: Any) -> str:
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int): return str(value)
    if isinstance(value, float): return _js_number(value)
    if isinstance(value, list): return "[" + ",".join(_stable_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value): raise TypeError("JSON object keys must be strings")
        return "{" + ",".join(_stable_json(key) + ":" + _stable_json(value[key]) for key in sorted(value)) + "}"
    raise TypeError("value is not JSON serializable")


def _derive_control_flow(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    regions = []
    for node in nodes:
        data = node.get("data") or {}
        if data.get("toolId") not in _LOOP_TYPES: continue
        node_id = node.get("id")
        def reachable(handle: str) -> set[str]:
            found: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == handle]
            while pending:
                current = pending.pop()
                if current in found: continue
                found.add(current)
                pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
            return found
        after = reachable("after"); body = reachable("body") - after
        regions.append({"nodeId": node_id, "type": data.get("toolId"), "bodyNodeIds": body, "afterNodeIds": after})
    def nearest(node_id: str) -> dict[str, Any] | None:
        candidates = [region for region in regions if node_id in region["bodyNodeIds"]]
        return next((candidate for candidate in candidates if not any(other["nodeId"] != candidate["nodeId"] and other["nodeId"] in candidate["bodyNodeIds"] for other in candidates)), None)
    loops = []
    for region in regions:
        parents = [candidate for candidate in regions if candidate["nodeId"] != region["nodeId"] and region["nodeId"] in candidate["bodyNodeIds"]]
        parent = next((candidate for candidate in parents if not any(other["nodeId"] != candidate["nodeId"] and other["nodeId"] in candidate["bodyNodeIds"] for other in parents)), None)
        loops.append({"nodeId": region["nodeId"], "type": region["type"], "bodyNodeIds": sorted(region["bodyNodeIds"]), "afterNodeIds": sorted(region["afterNodeIds"]), **({"parentLoopId": parent["nodeId"]} if parent else {})})
    transfers = []
    for node in nodes:
        tool_id = (node.get("data") or {}).get("toolId")
        if tool_id not in _TRANSFER_TYPES: continue
        owner = nearest(node.get("id"))
        if owner is None: raise ToolError("INVALID_CONTROL_FLOW", f"{tool_id} deve appartenere al body di un loop.")
        kind = _TRANSFER_TYPES[tool_id]
        if kind == "jumpPage" and owner["type"] != "loop.eachPage": raise ToolError("INVALID_CONTROL_FLOW", "flow.jumpPage è consentito solo in loop.eachPage.")
        transfers.append({"nodeId": node.get("id"), "kind": kind, "loopNodeId": owner["nodeId"]})
    return {"loops": loops, "transfers": transfers, "loopsByNode": {item["nodeId"]: item for item in loops}, "transfersByNode": {item["nodeId"]: item for item in transfers}}


def _control_flow_for(compiled_plan: Any, nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    derived = _derive_control_flow(nodes, edges)
    declared = compiled_plan.get("controlFlow") if isinstance(compiled_plan, dict) else None
    if declared is None: return derived
    if not isinstance(declared, dict) or not isinstance(declared.get("loops"), list) or not isinstance(declared.get("transfers"), list):
        raise ToolError("INVALID_PLAN", "controlFlow del piano compilato non valido.")
    for item in declared["loops"]:
        if not isinstance(item, dict) or not isinstance(item.get("nodeId"), str) or not isinstance(item.get("type"), str) or not isinstance(item.get("bodyNodeIds"), list) or not all(isinstance(value, str) for value in item["bodyNodeIds"]) or not isinstance(item.get("afterNodeIds"), list) or not all(isinstance(value, str) for value in item["afterNodeIds"]) or "parentLoopId" in item and not isinstance(item["parentLoopId"], str):
            raise ToolError("INVALID_PLAN", "Regione loop del piano compilato malformata.")
    for item in declared["transfers"]:
        if not isinstance(item, dict) or not isinstance(item.get("nodeId"), str) or item.get("kind") not in ("break", "continue", "jumpPage") or not isinstance(item.get("loopNodeId"), str):
            raise ToolError("INVALID_PLAN", "Trasferimento del piano compilato malformato.")
    canonical = lambda items, keys: sorted(tuple((key, tuple(sorted(item[key])) if key in ("bodyNodeIds", "afterNodeIds") else item.get(key)) for key in keys) for item in items if isinstance(item, dict))
    loop_keys = ("nodeId", "type", "bodyNodeIds", "afterNodeIds", "parentLoopId")
    transfer_keys = ("nodeId", "kind", "loopNodeId")
    if canonical(declared["loops"], loop_keys) != canonical(derived["loops"], loop_keys) or canonical(declared["transfers"], transfer_keys) != canonical(derived["transfers"], transfer_keys):
        raise ToolError("INVALID_PLAN", "controlFlow dichiarato non corrisponde ai rami del grafo.")
    return derived

def topological_order(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], *, deterministic: bool = False) -> list[str]:
    ids = [node.get("id") for node in nodes]
    if len(ids) != len(set(ids)) or any(not isinstance(item, str) for item in ids):
        raise ToolError("INVALID_GRAPH", "ID nodo duplicati o non validi.")
    known = set(ids); incoming = {node_id: 0 for node_id in ids}; adjacency = {node_id: [] for node_id in ids}
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source not in known or target not in known: raise ToolError("INVALID_GRAPH", "Collegamento a nodo inesistente.")
        adjacency[source].append(target); incoming[target] += 1
    queue = [node_id for node_id in ids if incoming[node_id] == 0]
    if deterministic: queue.sort()
    order = []
    while queue:
        node_id = queue.pop(0); order.append(node_id)
        for target in sorted(adjacency[node_id]) if deterministic else adjacency[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)
                if deterministic: queue.sort()
    if len(order) != len(nodes): raise ToolError("GRAPH_CYCLE", "Il grafo deve essere un DAG senza cicli.")
    return order


def _evaluate_expression(expression: Any, context: dict[str, Any], depth: int = 0, budget: list[int] | None = None) -> Any:
    if budget is None: budget = [512]
    budget[0] -= 1
    if budget[0] < 0 or depth > 32 or not isinstance(expression, dict):
        raise ToolError("INVALID_BINDING", "Espressione oltre i limiti o non valida.")
    op = expression.get("op")
    def ev(item: Any) -> Any: return _evaluate_expression(item, context, depth + 1, budget)
    if op == "literal": return expression.get("value")
    if op == "path":
        root, path = expression.get("root"), expression.get("path")
        if root not in ("api", "nodes", "variables", "loop") or not isinstance(path, list) or not path or len(path) > 32:
            raise ToolError("INVALID_BINDING", "Percorso espressione non valido.")
        value: Any = context[root]
        for part in path:
            if not isinstance(part, str) or part in ("__proto__", "prototype", "constructor"):
                raise ToolError("INVALID_BINDING", "Percorso espressione non consentito.")
            value = value.get(part) if isinstance(value, dict) else None
        return value
    if op in ("eq", "neq", "gt", "gte", "lt", "lte", "contains"):
        left, right = ev(expression.get("left")), ev(expression.get("right"))
        if op == "eq": return left == right
        if op == "neq": return left != right
        if op in ("gt", "gte", "lt", "lte"):
            if isinstance(left, bool) or isinstance(right, bool) or not isinstance(left, (int, float)) or not isinstance(right, (int, float)) or not math.isfinite(left) or not math.isfinite(right):
                raise ToolError("INVALID_BINDING", "Il confronto numerico richiede numeri finiti.")
            return {"gt": left > right, "gte": left >= right, "lt": left < right, "lte": left <= right}[op]
        if isinstance(left, str) and isinstance(right, str): return right in left
        if isinstance(left, list): return right in left
        raise ToolError("INVALID_BINDING", "contains richiede una stringa o un array.")
    if op in ("and", "or"):
        args = expression.get("args")
        if not isinstance(args, list) or not 1 <= len(args) <= 32: raise ToolError("INVALID_BINDING", "Argomenti logici non validi.")
        result = [bool(ev(item)) for item in args]
        return all(result) if op == "and" else any(result)
    if op == "not": return not bool(ev(expression.get("value")))
    if op in ("add", "concat"):
        args = expression.get("args")
        if not isinstance(args, list) or not 1 <= len(args) <= 32: raise ToolError("INVALID_BINDING", "Argomenti espressione non validi.")
        values = [ev(item) for item in args]
        if op == "add":
            if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in values): raise ToolError("INVALID_BINDING", "add richiede numeri finiti.")
            return sum(values)
        if any(item is not None and not isinstance(item, (str, int, float, bool)) for item in values): raise ToolError("INVALID_BINDING", "concat accetta solo valori semplici.")
        return "".join("null" if item is None else str(item) for item in values)
    if op == "if": return ev(expression.get("then")) if ev(expression.get("condition")) else ev(expression.get("else"))
    raise ToolError("INVALID_BINDING", "Operatore espressione non supportato.")


def _substitute(value: Any, parameters: dict[str, Any], nodes: dict[str, dict[str, Any]] | None = None,
                variables: dict[str, Any] | None = None, loop: dict[str, Any] | None = None,
                variable_frames: list[dict[str, Any]] | None = None) -> Any:
    if isinstance(value, dict):
        if isinstance(value.get("source"), str) and value.get("source") in ("constant", "api", "node", "variable", "loop", "expression"):
            source = value.get("source")
            if source == "constant": resolved = value.get("value")
            if source == "api":
                name = value.get("name")
                if name not in parameters: raise ToolError("MISSING_BINDING", "Parametro API del binding non disponibile.")
                resolved = parameters[name]
            elif source == "node":
                output = (nodes or {}).get(value.get("nodeId"), {})
                port = value.get("port")
                if port not in output: raise ToolError("MISSING_BINDING", "Output del nodo richiesto non disponibile.")
                resolved = output[port]
            elif source == "variable":
                name = value.get("name")
                scope = value.get("scope", "workflow")
                if scope == "loop":
                    resolved = next((frame[name] for frame in reversed(variable_frames or []) if name in frame), None)
                    if not any(name in frame for frame in (variable_frames or [])): raise ToolError("MISSING_BINDING", "Variabile loop non disponibile.")
                else:
                    if name not in (variables or {}): raise ToolError("MISSING_BINDING", "Variabile di contesto non disponibile.")
                    resolved = (variables or {})[name]
            elif source == "loop":
                name = value.get("name")
                if name not in (loop or {}): raise ToolError("MISSING_BINDING", "Variabile loop fuori scope.")
                resolved = (loop or {})[name]
            elif source == "expression": resolved = _evaluate_expression(value.get("expression"), {"api": parameters, "nodes": nodes or {}, "variables": variables or {}, "loop": loop or {}})
            elif source != "constant": raise ToolError("INVALID_BINDING", "Origine binding non supportata.")
            path = value.get("path", [])
            if not isinstance(path, list) or len(path) > 16: raise ToolError("INVALID_BINDING", "Percorso binding non valido.")
            for part in path:
                if not isinstance(part, str) or part in ("__proto__", "prototype", "constructor"):
                    raise ToolError("INVALID_BINDING", "Percorso binding non consentito.")
                if isinstance(resolved, dict):
                    if part not in resolved: raise ToolError("MISSING_BINDING", f"Proprietà del binding non disponibile: {part}.")
                    resolved = resolved[part]
                elif isinstance(resolved, list) and re.fullmatch(r"0|[1-9][0-9]*", part):
                    index = int(part)
                    if index >= len(resolved): raise ToolError("MISSING_BINDING", f"Indice del binding non disponibile: {part}.")
                    resolved = resolved[index]
                else: raise ToolError("MISSING_BINDING", f"Percorso del binding non disponibile: {part}.")
            return resolved
        if set(value) == {"$param"}:
            name = value["$param"]
            if name not in parameters: raise ToolError("MISSING_PARAMETER", f"Parametro API mancante: {name}.")
            return parameters[name]
        return {key: _substitute(item, parameters, nodes, variables, loop, variable_frames) for key, item in value.items()}
    if isinstance(value, list): return [_substitute(item, parameters, nodes, variables, loop, variable_frames) for item in value]
    return value


def _safe(value: Any) -> Any:
    if isinstance(value, str) and value.lower().endswith(".pdf") and Path(value).is_file(): return {"file": Path(value).name}
    if isinstance(value, dict): return {key: _safe(item) for key, item in value.items()}
    if isinstance(value, list): return [_safe(item) for item in value]
    return value


def _safe_output_filename(value: Any) -> str:
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(str(value or "output.pdf")).name).strip("._-")
    if not filename:
        filename = "output.pdf"
    if not filename.lower().endswith(".pdf"):
        filename = f"{filename}.pdf"
    if len(filename) > 120:
        filename = f"{Path(filename).stem[:116].rstrip('._-')}.pdf"
    return filename


def _register_output(outputs: list[dict[str, Any]], artifact: dict[str, Any]) -> dict[str, Any]:
    filename = _safe_output_filename(artifact.get("filename"))
    policy = artifact.get("collisionPolicy", "rename")
    if policy not in {"error", "rename", "overwrite"}:
        raise ToolError("INVALID_PARAMS", "collisionPolicy deve essere error, rename o overwrite.")
    colliding = [item for item in outputs if str(item.get("filename", "")).casefold() == filename.casefold()]
    if colliding and policy == "error":
        raise ToolError("OUTPUT_COLLISION", f"Esiste già un artifact chiamato '{filename}'.")
    if colliding and policy == "overwrite":
        outputs[:] = [item for item in outputs if str(item.get("filename", "")).casefold() != filename.casefold()]
    if colliding and policy == "rename":
        stem = Path(filename).stem
        suffix = Path(filename).suffix or ".pdf"
        index = 2
        candidate = _safe_output_filename(f"{stem}-{index}{suffix}")
        existing = {str(item.get("filename", "")).casefold() for item in outputs}
        while candidate.casefold() in existing:
            index += 1
            candidate = _safe_output_filename(f"{stem}-{index}{suffix}")
        filename = candidate
    if len(outputs) >= 200:
        raise ToolError("OUTPUT_LIMIT", "Un job non può produrre più di 200 artifact.")
    registered = {**artifact, "filename": filename}
    outputs.append(registered)
    return registered


def _artifact_manifest(path: str, filename: str, content_type: str) -> dict[str, Any]:
    file = Path(path)
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"filename": filename, "contentType": content_type, "sizeBytes": file.stat().st_size, "sha256": digest.hexdigest()}


def _for_each_value_matches(item: Any, filter_config: dict[str, Any]) -> bool:
    column, operator = filter_config.get("column"), filter_config.get("operator")
    if not isinstance(column, str) or not isinstance(operator, str):
        raise ToolError("INVALID_PARAMS", "Filtro loop.forEach non valido: indicare colonna e operatore.")
    left = item if column == "$item" else item.get(column) if isinstance(item, dict) else None
    if column != "$item" and (not isinstance(item, dict) or column not in item):
        raise ToolError("INVALID_PARAMS", f"La colonna '{column}' non è presente in una riga.")
    right = filter_config.get("value")
    if operator == "isNull": return left is None
    if operator == "isEmpty": return left is None or left == "" or left == [] or left == {}
    if operator in ("eq", "neq"):
        equal = type(left) is type(right) and left == right
        return equal if operator == "eq" else not equal
    if operator in ("gt", "gte", "lt", "lte"):
        if isinstance(left, bool) or isinstance(right, bool) or not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
            raise ToolError("INVALID_PARAMS", f"L'operatore {operator} del filtro richiede due numeri.")
        return {"gt": left > right, "gte": left >= right, "lt": left < right, "lte": left <= right}[operator]
    if operator in ("contains", "notContains", "startsWith", "endsWith"):
        if isinstance(left, str) and isinstance(right, str):
            matched = right in left if operator in ("contains", "notContains") else left.startswith(right) if operator == "startsWith" else left.endswith(right)
        elif operator in ("contains", "notContains") and isinstance(left, list):
            matched = any(type(value) is type(right) and value == right for value in left)
        else:
            raise ToolError("INVALID_PARAMS", f"L'operatore {operator} del filtro richiede stringhe" + (" o array." if operator in ("contains", "notContains") else "."))
        return not matched if operator == "notContains" else matched
    if operator in ("in", "notIn"):
        if not isinstance(right, list): raise ToolError("INVALID_PARAMS", f"L'operatore {operator} richiede un valore array.")
        matched = any(type(value) is type(left) and value == left for value in right)
        return matched if operator == "in" else not matched
    raise ToolError("INVALID_PARAMS", f"Operatore filtro non supportato: {operator}.")


def _validate_for_each_item(item: Any, item_type: str, columns: list[dict[str, Any]]) -> None:
    valid = {
        "string": lambda value: isinstance(value, str),
        "number": lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
        "boolean": lambda value: isinstance(value, bool),
        "object": lambda value: isinstance(value, dict),
        "array": lambda value: isinstance(value, list),
    }
    if item_type not in valid or not valid[item_type](item):
        raise ToolError("INVALID_ITEM", f"loop.forEach attende item di tipo {item_type}.")
    if item_type != "object": return
    for column in columns:
        name, expected = column.get("name"), column.get("type")
        if not isinstance(name, str) or not isinstance(expected, str): raise ToolError("INVALID_PARAMS", "Dichiarazione colonna loop.forEach non valida.")
        if name not in item: raise ToolError("INVALID_ITEM", f"La colonna obbligatoria '{name}' manca dalla riga.")
        value = item[name]
        is_valid = {
            "string": lambda current: isinstance(current, str),
            "number": lambda current: isinstance(current, (int, float)) and not isinstance(current, bool) and math.isfinite(current),
            "boolean": lambda current: isinstance(current, bool),
            "object": lambda current: isinstance(current, dict),
            "array": lambda current: isinstance(current, list),
        }.get(expected)
        if is_valid is None or not is_valid(value): raise ToolError("INVALID_ITEM", f"La colonna '{name}' non rispetta il tipo dichiarato {expected}.")


class WorkflowExecutor:
    def __init__(self, registry: ToolRegistry): self.registry = registry

    def execute(self, graph: dict[str, Any], api_input: dict[str, Any], input_files: dict[str, str], context: ToolContext,
                report_step: Callable[[dict[str, Any]], None], heartbeat: Callable[[int, str | None, int], None], *,
                _values: dict[str, dict[str, Any]] | None = None, _loop_scope: dict[str, Any] | None = None,
                _internal: bool = False, _depth: int = 0, _deferred_deletions: dict[str, set[int]] | None = None,
                _deferred_bookmarks: dict[str, list[dict[str, Any]]] | None = None,
                _variables: dict[str, Any] | None = None, _iteration_budget: list[int] | None = None,
                _control_flow: dict[str, Any] | None = None, _variable_frames: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if _depth > 4: raise ToolError("LOOP_DEPTH", "I cicli annidati superano la profondità massima (4).")
        compiled_plan = graph.get("compiledPlan")
        if isinstance(compiled_plan, dict):
            plan_version = compiled_plan.get("formatVersion")
            if plan_version not in (1, 2) or not isinstance(compiled_plan.get("order"), list) or not isinstance(compiled_plan.get("blocks"), list):
                raise ToolError("INVALID_PLAN", "Piano compilato non supportato o incompleto.")
            if plan_version == 2:
                if compiled_plan.get("compilerVersion") != "2.0.0" or not re.fullmatch(r"[a-f0-9]{64}", str(compiled_plan.get("graphHash", ""))) or not re.fullmatch(r"[a-f0-9]{64}", str(compiled_plan.get("planHash", ""))):
                    raise ToolError("INVALID_PLAN", "Versione o hash del piano compilato non valido.")
                manifest = compiled_plan.get("manifest")
                if not isinstance(manifest, dict) or not all(isinstance(manifest.get(key), list) for key in ("apiParameters", "variables", "handlers")):
                    raise ToolError("INVALID_PLAN", "Manifest API, variabili o handler mancante nel piano.")
            # The persisted version includes graph plus plan. The graph remains authoritative
            # for values and edges; plan order/handler declarations are verified against it.
            if any(not isinstance(item, dict) or not isinstance(item.get("nodeId"), str) for item in compiled_plan["blocks"]):
                raise ToolError("INVALID_PLAN", "Il piano contiene istruzioni senza nodeId valido.")
            declared = {item.get("nodeId"): item for item in compiled_plan["blocks"] if isinstance(item, dict)}
            if len(declared) != len(compiled_plan["blocks"]):
                raise ToolError("INVALID_PLAN", "Il piano contiene istruzioni duplicate.")
            for block in compiled_plan["blocks"]:
                if not isinstance(block, dict) or not isinstance(block.get("handlerId"), str) or not isinstance(block.get("type"), str):
                    raise ToolError("INVALID_PLAN", "Handler del piano compilato non coerente.")
                if plan_version == 2 and not isinstance(block.get("parameters"), dict):
                    raise ToolError("INVALID_PLAN", "Parametri istruzione mancanti nel piano compilato.")
                if block.get("worker") == "python":
                    self.registry.get(block["handlerId"], str(block.get("version")))
                elif block.get("worker") == "orchestrator":
                    if block.get("handlerId") not in {"input.pdf", "input.pdf-list", "output.pdf", "pdf.output", "pdf.qr.removeMatchedPages", "loop.eachPage", "loop.forEach", "loop.while", "loop.repeatUntil", "flow.break", "flow.continue", "flow.jumpPage", "data.setVariable"}:
                        raise ToolError("INVALID_PLAN", "Handler orchestrator non supportato dal worker.")
                else:
                    raise ToolError("INVALID_PLAN", "Runtime del blocco non supportato dal worker.")
            graph = {**graph, "compiledOrder": compiled_plan["order"], "compiledBlocks": declared}
        nodes, edges = graph.get("nodes"), graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list) or len(nodes) > 200 or len(edges) > 500:
            raise ToolError("INVALID_GRAPH", "Grafo non valido o troppo grande.")
        control_flow = _control_flow or _control_flow_for(compiled_plan, nodes, edges)
        def verify_loop_region(loop_id: str, body_ids: set[str], after_ids: set[str]) -> None:
            region = control_flow["loopsByNode"].get(loop_id)
            if region is None or set(region["bodyNodeIds"]) != body_ids or set(region["afterNodeIds"]) != after_ids:
                raise ToolError("INVALID_PLAN", "Le regioni del loop non corrispondono al controlFlow compilato.")
        local_ids = {node.get("id") for node in nodes}
        if isinstance(compiled_plan, dict) and compiled_plan.get("formatVersion") == 2:
            def edge_order_key(edge: dict[str, Any]) -> str:
                return "\0".join(str(value if value is not None else "") for value in (edge.get("source"), edge.get("sourceHandle"), edge.get("target"), edge.get("targetHandle"), edge.get("id")))
            canonical_graph = {
                "nodes": [{"id": node.get("id"), "type": node.get("type"), "position": node.get("position"), "data": node.get("data")} for node in sorted(nodes, key=lambda item: item.get("id", ""))],
                "edges": sorted(edges, key=edge_order_key),
            }
            try:
                graph_hash = hashlib.sha256(_stable_json(canonical_graph).encode("utf-8")).hexdigest()
                plan_body = {key: value for key, value in compiled_plan.items() if key != "planHash"}
                plan_hash = hashlib.sha256(_stable_json(plan_body).encode("utf-8")).hexdigest()
            except (TypeError, ValueError) as exc:
                raise ToolError("INVALID_PLAN", "Il piano contiene valori non serializzabili.") from exc
            if graph_hash != compiled_plan.get("graphHash"):
                raise ToolError("INVALID_PLAN", "Hash del grafo non corrispondente alla versione pubblicata.")
            if plan_hash != compiled_plan.get("planHash"):
                raise ToolError("INVALID_PLAN", "Hash del piano compilato non valido.")
            if set(compiled_plan["order"]) != local_ids or len(compiled_plan["order"]) != len(local_ids) or set(compiled_plan["blocks"][i]["nodeId"] for i in range(len(compiled_plan["blocks"]))) != local_ids:
                raise ToolError("INVALID_PLAN", "Istruzioni e ordine del piano non coprono i nodi del grafo.")
            plan_edges = compiled_plan.get("edges")
            if not isinstance(plan_edges, list) or len(plan_edges) != len(edges):
                raise ToolError("INVALID_PLAN", "Il numero di edge del piano non corrisponde al grafo.")
            def edge_signature(edge: dict[str, Any]) -> tuple[Any, ...]:
                data = edge.get("data") if isinstance(edge.get("data"), dict) else {}
                return (edge.get("id"), edge.get("source"), edge.get("target"), edge.get("sourceHandle"), edge.get("targetHandle"), data.get("kind"))
            if sorted(edge_signature(edge) for edge in plan_edges if isinstance(edge, dict)) != sorted(edge_signature(edge) for edge in edges if isinstance(edge, dict)):
                raise ToolError("INVALID_PLAN", "Gli edge del piano non corrispondono alla topologia del grafo.")
            manifest = compiled_plan["manifest"]
            expected_handlers = {(item.get("type"), item.get("version"), item.get("handlerId"), item.get("worker"), item.get("timeoutSeconds"), item.get("resourceClass")) for item in compiled_plan["blocks"]}
            handler_items = manifest["handlers"]
            if any(not isinstance(item, dict) for item in handler_items):
                raise ToolError("INVALID_PLAN", "Manifest handler non valido.")
            actual_handlers = {(item.get("type"), item.get("version"), item.get("handlerId"), item.get("worker"), item.get("timeoutSeconds"), item.get("resourceClass")) for item in handler_items}
            if actual_handlers != expected_handlers:
                raise ToolError("INVALID_PLAN", "Il manifest degli handler non corrisponde alle istruzioni compilate.")
            for manifest_key in ("apiParameters", "variables"):
                entries = manifest[manifest_key]
                if any(not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("type"), str) or not isinstance(item.get("required"), bool) for item in entries):
                    raise ToolError("INVALID_PLAN", f"Manifest {manifest_key} non valido.")
                names = [item["name"] for item in entries]
                if len(set(names)) != len(names):
                    raise ToolError("INVALID_PLAN", f"Manifest {manifest_key} contiene nomi duplicati.")
        order = topological_order(nodes, [edge for edge in edges if edge.get("source") in local_ids and edge.get("target") in local_ids] if _internal else edges, deterministic=isinstance(compiled_plan, dict) and compiled_plan.get("formatVersion") == 2); by_id = {node["id"]: node for node in nodes}; values = _values if _values is not None else {}; skipped: set[str] = set(); pages = 0; outputs: list[dict[str, Any]] = []; completed_body: set[str] = set(); deferred_deletions = _deferred_deletions if _deferred_deletions is not None else {}; deferred_bookmarks = _deferred_bookmarks if _deferred_bookmarks is not None else {}
        if isinstance(graph.get("compiledOrder"), list):
            if set(graph["compiledOrder"]) != set(by_id) or len(graph["compiledOrder"]) != len(by_id):
                raise ToolError("INVALID_PLAN", "Ordine del piano non corrisponde ai nodi del grafo.")
            if graph["compiledOrder"] != order:
                raise ToolError("INVALID_PLAN", "Ordine del piano non coerente con le dipendenze.")
            order = graph["compiledOrder"]
        compiled_blocks = graph.get("compiledBlocks", {})
        variables: dict[str, Any] = _variables if _variables is not None else {}
        variable_frames = _variable_frames if _variable_frames is not None else []
        iteration_budget = _iteration_budget if _iteration_budget is not None else [10000]
        for variable in graph.get("variables", []) if isinstance(graph.get("variables", []), list) else []:
            if not isinstance(variable, dict) or not isinstance(variable.get("name"), str):
                raise ToolError("INVALID_GRAPH", "Definizione variabile non valida.")
            name = variable["name"]
            var_type, default = variable.get("type"), variable.get("defaultValue")
            valid_default = default is None or (var_type == "string" and isinstance(default, str)) or (var_type == "number" and isinstance(default, (int, float)) and not isinstance(default, bool) and math.isfinite(default)) or (var_type == "boolean" and isinstance(default, bool)) or (var_type == "object" and isinstance(default, dict)) or (var_type == "array" and isinstance(default, list))
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or name in variables or var_type not in ("string", "number", "boolean", "object", "array") or not valid_default:
                raise ToolError("INVALID_GRAPH", "Nome variabile non valido o duplicato.")
            if default is not None:
                variables[name] = default
        file_paths = [input_files[value] for value in api_input.values() if isinstance(value, str) and value in input_files]
        for value in api_input.values():
            if isinstance(value, list): file_paths.extend(input_files[item] for item in value if isinstance(item, str) and item in input_files)
        file_paths.extend(path for path in input_files.values() if path not in file_paths)
        max_tool_timeout = context.timeout_seconds
        pending_transfer: dict[str, Any] | None = None
        for position, node_id in enumerate(order):
            if pending_transfer is not None:
                skipped.add(node_id)
                node = by_id[node_id]; data = node.get("data") or {}
                report_step({"nodeId": node_id, "toolId": data.get("toolId"), "toolVersion": data.get("toolVersion", "1.0.0"), "status": "SKIPPED", "progress": 100, "output": {"reason": f"Uscita dal body con {pending_transfer['kind']}"}})
                continue
            if node_id in completed_body: continue
            context.check(); node = by_id[node_id]; data = node.get("data") or {}; tool_id = data.get("toolId"); version = data.get("toolVersion", "1.0.0")
            compiled = compiled_blocks.get(node_id) if isinstance(compiled_blocks, dict) else None
            handler_id = compiled.get("handlerId") if isinstance(compiled, dict) else tool_id
            if compiled and (compiled.get("type") != tool_id or compiled.get("version") != version or not isinstance(compiled.get("parameters"), dict)):
                raise ToolError("INVALID_PLAN", "Definizione nodo diversa da quella compilata.")
            # For format v2 the immutable compiled instruction is authoritative.
            # The editor graph is used only for labels/positions and has already
            # been checked against graphHash, edges and the compiled node set.
            raw_parameters = compiled.get("parameters") if isinstance(compiled, dict) and compiled_plan.get("formatVersion") == 2 else data.get("parameters") or {}
            if tool_id in ("logic.conditionGroup", "loop.while", "loop.repeatUntil") and isinstance(raw_parameters, dict):
                # Keep leaf bindings unresolved so AND/OR can short-circuit without
                # touching values in branches that are not evaluated.
                parameters = raw_parameters
                context.binding_resolver = lambda value: _substitute(value, api_input, values, variables, _loop_scope, variable_frames)
            elif tool_id == "loop.forEach" and isinstance(raw_parameters, dict):
                context.binding_resolver = None
                parameters = {**raw_parameters, "source": _substitute(raw_parameters.get("source"), api_input, values, variables, _loop_scope, variable_frames)}
            else:
                context.binding_resolver = None
                parameters = _substitute(raw_parameters, api_input, values, variables, _loop_scope, variable_frames)
            handled_failure = False
            node_transfer: dict[str, Any] | None = None
            incoming = [edge for edge in edges if edge["target"] == node_id]
            active = [edge for edge in incoming if edge["source"] in values and edge["source"] not in skipped and edge.get("sourceHandle") in values[edge["source"]]]
            control_incoming = [edge for edge in incoming if edge.get("targetHandle") == "run"]
            active_control = [edge for edge in control_incoming if edge in active]
            if tool_id == "input.pdf":
                requested = api_input.get(parameters.get("parameter")) if parameters.get("parameter") else None
                path = input_files.get(requested) if isinstance(requested, str) else None
                if path is None: path = file_paths[0] if file_paths else next(iter(input_files.values()), None)
                if not path: raise ToolError("MISSING_INPUT", "Nessun PDF di input è associato al batch.")
                result = ToolResult({"pdf": path}, len(context.pdf(path).pages))
            elif tool_id == "input.pdf-list":
                requested = api_input.get(parameters.get("parameter")) if parameters.get("parameter") else None
                if not isinstance(requested, list) or not requested: raise ToolError("MISSING_INPUT", "Specificare una lista non vuota di PDF.")
                documents = []
                for file_id in requested:
                    path = input_files.get(file_id) if isinstance(file_id, str) else None
                    if not path: raise ToolError("MISSING_INPUT", "Uno dei PDF selezionati non è disponibile.")
                    resolved_path = str(Path(path).resolve())
                    documents.append({"fileRef": context.source_file_refs.get(resolved_path, str(file_id)), "filename": context.source_filenames.get(resolved_path, Path(path).name), "path": path})
                result = ToolResult({"pdfs": documents}, sum(len(context.pdf(item["path"]).pages) for item in documents))
            elif control_incoming and not active_control:
                skipped.add(node_id); report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "SKIPPED", "progress": 100, "output": {"reason": "Nessun ramo di controllo attivo"}}); continue
            elif incoming and not active:
                skipped.add(node_id); report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "SKIPPED", "progress": 100, "output": {"reason": "Ramo non selezionato"}}); continue
            else:
                tool_inputs: dict[str, Any] = {}
                for edge in active:
                    if edge.get("targetHandle") == "run": continue
                    target_handle = edge.get("targetHandle") or "value"; source_handle = edge.get("sourceHandle") or "value"; value = values[edge["source"]][source_handle]
                    if target_handle in tool_inputs: tool_inputs[target_handle] = [*tool_inputs[target_handle], value] if isinstance(tool_inputs[target_handle], list) else [tool_inputs[target_handle], value]
                    else: tool_inputs[target_handle] = value
                if tool_id == "data.setVariable":
                    name, scope, value_type = parameters.get("name"), parameters.get("scope"), parameters.get("valueType")
                    value = parameters.get("value")
                    valid = value_type == "string" and isinstance(value, str) or value_type == "number" and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) or value_type == "boolean" and isinstance(value, bool) or value_type == "object" and isinstance(value, dict) or value_type == "array" and isinstance(value, list)
                    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or name in ("__proto__", "prototype", "constructor") or not valid:
                        raise ToolError("INVALID_PARAMS", "data.setVariable richiede nome e valore del tipo dichiarato.")
                    if scope == "workflow": variables[name] = value
                    elif scope == "loop" and variable_frames: variable_frames[-1][name] = value
                    elif scope == "loop": raise ToolError("LOOP_SCOPE_REQUIRED", "Una variabile loop si può impostare solo nel body di un ciclo.")
                    else: raise ToolError("INVALID_PARAMS", "Scope variabile non valido.")
                    result = ToolResult({"value": value, "success": {"active": True}})
                elif tool_id in _TRANSFER_TYPES:
                    transfer = control_flow["transfersByNode"].get(node_id)
                    if transfer is None or _loop_scope is None or transfer.get("loopNodeId") != _loop_scope.get("_loopId"):
                        raise ToolError("INVALID_CONTROL_FLOW", f"{tool_id} non è disponibile nello scope del loop corrente.")
                    transfer_kind = transfer["kind"]
                    output_port = {"break": "break", "continue": "continue", "jumpPage": "jump"}[transfer_kind]
                    node_transfer = {"kind": transfer_kind, "loopNodeId": transfer["loopNodeId"]}
                    if transfer_kind == "jumpPage":
                        current_page = _loop_scope.get("currentPage")
                        mode, value = parameters.get("targetMode"), parameters.get("value")
                        if not isinstance(current_page, int) or isinstance(current_page, bool) or mode not in ("absolute", "relative") or not isinstance(value, int) or isinstance(value, bool):
                            raise ToolError("INVALID_PARAMS", "Configurazione flow.jumpPage non valida.")
                        if mode == "absolute" and value < 1 or mode == "relative" and value == 0:
                            raise ToolError("INVALID_PARAMS", "flow.jumpPage richiede una pagina assoluta positiva o uno spostamento relativo non nullo.")
                        target_page = value if mode == "absolute" else current_page + value
                        start_page, end_page, page_count = _loop_scope.get("_pageStart"), _loop_scope.get("_pageEnd"), _loop_scope.get("_pageCount")
                        if not isinstance(start_page, int) or not isinstance(end_page, int) or not isinstance(page_count, int) or not start_page <= target_page <= end_page or target_page > page_count:
                            raise ToolError("PAGE_RANGE", f"flow.jumpPage target {target_page} fuori dall'intervallo {start_page}–{end_page}.")
                        node_transfer["targetPage"] = target_page
                    result = ToolResult({output_port: {"active": True}}, 0)
                elif tool_id == "loop.eachPage":
                    if _depth >= 4: raise ToolError("LOOP_DEPTH", "I cicli annidati superano la profondità massima (4).")
                    source_pdf = tool_inputs.get("document")
                    if isinstance(source_pdf, list): source_pdf = source_pdf[0] if source_pdf else None
                    if not isinstance(source_pdf, str): raise ToolError("MISSING_INPUT", "loop.eachPage richiede un documento PDF collegato.")
                    snapshot = context.pdf(source_pdf); page_count = len(snapshot.pages)
                    start, end, step = parameters.get("start", 1), parameters.get("end", page_count), parameters.get("step", 1)
                    limit = min(int(parameters.get("maxIterations", 1000)), 1000)
                    if any(not isinstance(value, int) or isinstance(value, bool) for value in (start, end, step, limit)) or start < 1 or end < start or step < 1 or limit < 1:
                        raise ToolError("INVALID_PARAMS", "Intervallo loop non valido: start/end/step devono essere positivi e maxIterations tra 1 e 1000.")
                    if end > page_count: raise ToolError("INVALID_PARAMS", f"La pagina finale {end} supera il documento ({page_count} pagine).")
                    body_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "body"]
                    while pending:
                        current = pending.pop()
                        if current in body_ids: continue
                        body_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    after_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "after"]
                    while pending:
                        current = pending.pop()
                        if current in after_ids: continue
                        after_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    body_ids -= after_ids
                    if not body_ids: raise ToolError("INVALID_GRAPH", "Collega almeno un nodo al ramo body del ciclo.")
                    verify_loop_region(node_id, body_ids, after_ids)
                    body_nodes = [item for item in nodes if item.get("id") in body_ids]
                    body_edges = [edge for edge in edges if edge.get("target") in body_ids]
                    doc_hash = hashlib.sha256(Path(source_pdf).read_bytes()).hexdigest()[:16]
                    deferred_deletions[node_id] = set()
                    loop_value: dict[str, Any] = {"document": source_pdf, "pageCount": page_count, "body": {"active": True}}
                    processed_pages: dict[int, str] = {}
                    values[node_id] = loop_value
                    page_number = start; iterations = 0
                    loop_frame: dict[str, Any] = {}
                    while page_number <= end:
                        context.check()
                        if iterations >= limit: raise ToolError("ITERATION_LIMIT", f"Il ciclo richiede un'altra iterazione, oltre maxIterations={limit}.")
                        if iteration_budget[0] <= 0: raise ToolError("ITERATION_LIMIT", "Il workflow ha superato il limite totale di 10000 iterazioni.")
                        iteration_budget[0] -= 1
                        index = iterations; iterations += 1
                        loop_scope = {"currentPage": page_number, "pageId": f"{doc_hash}:page:{page_number}", "pageCount": page_count, "index": index, "_loopId": node_id, "_pageStart": start, "_pageEnd": end, "_pageCount": page_count}
                        page_writer = PdfWriter(); page_writer.add_page(snapshot.pages[page_number - 1])
                        page_path = context.output_path()
                        with page_path.open("wb") as page_stream: page_writer.write(page_stream)
                        page_document = str(page_path); context.pdf(page_document)
                        loop_value["document"] = page_document
                        loop_value.update({key: value for key, value in loop_scope.items() if not key.startswith("_")})
                        for body_id in body_ids: values.pop(body_id, None)
                        report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": min(99, int(index * 100 / limit)), "output": {"currentPage": page_number, "pageId": loop_scope["pageId"], "pageCount": page_count, "index": index, "iteration": index + 1, "maxIterations": limit}})
                        body_result = self.execute({"nodes": body_nodes, "edges": body_edges}, api_input, input_files, context, report_step, heartbeat, _values=values, _loop_scope=loop_scope, _internal=True, _depth=_depth + 1, _deferred_deletions=deferred_deletions, _deferred_bookmarks=deferred_bookmarks, _variables=variables, _iteration_budget=iteration_budget, _control_flow=control_flow, _variable_frames=[*variable_frames, loop_frame])
                        pages += body_result.get("pagesProcessed", 0)
                        completed_body.update(body_ids)
                        final_page = page_document
                        for body_id in reversed([item["id"] for item in body_nodes]):
                            candidate = values.get(body_id, {}).get("pdf")
                            if isinstance(candidate, str) and Path(candidate).is_file(): final_page = candidate; break
                        if len(context.pdf(final_page).pages) != 1: raise ToolError("PAGE_IDENTITY_LOST", "Ogni iterazione del body deve restituire al massimo un PDF di una sola pagina.")
                        processed_pages[page_number] = final_page
                        loop_value.update({key: value for key, value in loop_scope.items() if not key.startswith("_")})
                        context.check()
                        heartbeat(int((position + min(iterations / limit, 0.99)) / max(1, len(order)) * 95), node_id, pages)
                        transfer = body_result.get("controlTransfer")
                        if transfer is not None:
                            if transfer.get("loopNodeId") != node_id: raise ToolError("INVALID_CONTROL_FLOW", "Il trasferimento non appartiene al loop.eachPage corrente.")
                            if transfer.get("kind") == "break": break
                            if transfer.get("kind") == "jumpPage": page_number = int(transfer["targetPage"])
                            elif transfer.get("kind") == "continue": page_number += step
                            else: raise ToolError("INVALID_CONTROL_FLOW", "Trasferimento non supportato in loop.eachPage.")
                        else: page_number += step
                    removed = sorted(deferred_deletions.pop(node_id, set()))
                    remaining_pages = [original for original in range(1, page_count + 1) if original not in set(removed)]
                    if not remaining_pages: raise ToolError("EMPTY_DOCUMENT", "Il loop non può eliminare tutte le pagine del documento.")
                    writer = PdfWriter()
                    for original in remaining_pages:
                        page_file = processed_pages.get(original)
                        if page_file is None:
                            writer.add_page(snapshot.pages[original - 1]); continue
                        page_reader = context.pdf(page_file)
                        if len(page_reader.pages) != 1: raise ToolError("PAGE_IDENTITY_LOST", "Ogni pagina raccolta dal loop deve contenere esattamente una pagina.")
                        writer.add_page(page_reader.pages[0])
                    original_to_output = {original: index for index, original in enumerate(remaining_pages)}
                    for bookmark in deferred_bookmarks.pop(node_id, []):
                        target_original = next((original for original in remaining_pages if original >= bookmark["page"]), None)
                        if target_original is not None:
                            context.check()
                            writer.add_outline_item(bookmark["description"], original_to_output[target_original])
                    metadata = {str(key): str(value) for key, value in (snapshot.metadata or {}).items() if value is not None}
                    if metadata: writer.add_metadata(metadata)
                    assembled_path = context.output_path()
                    with assembled_path.open("wb") as assembled_stream: writer.write(assembled_stream)
                    assembled_pdf = str(assembled_path); context.pdf(assembled_pdf)
                    loop_value.update({"pageCount": page_count, "after": {"active": True}, "success": {"active": True}})
                    loop_value["document"] = assembled_pdf
                    result = ToolResult(dict(loop_value), iterations + page_count)
                elif tool_id == "loop.forEach":
                    if _depth >= 4: raise ToolError("LOOP_DEPTH", "I cicli annidati superano la profondità massima (4).")
                    source_items = parameters.get("source")
                    if isinstance(source_items, dict) and isinstance(source_items.get("rows"), list): source_items = source_items["rows"]
                    if not isinstance(source_items, list): raise ToolError("INVALID_INPUT", "loop.forEach richiede un array JSON o una tabella con rows array.")
                    if len(source_items) > 10000: raise ToolError("ITERATION_LIMIT", "La sorgente loop.forEach supera il limite di 10000 righe.")
                    item_type = parameters.get("itemType", "object"); columns = parameters.get("columns", []); filter_config = parameters.get("filter")
                    limit = parameters.get("maxIterations", 1000)
                    if item_type not in ("string", "number", "boolean", "object", "array") or not isinstance(columns, list) or not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
                        raise ToolError("INVALID_PARAMS", "Configurazione loop.forEach non valida: tipo elemento o maxIterations fuori limite.")
                    names = [column.get("name") for column in columns if isinstance(column, dict)]
                    if len(names) != len(columns) or any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or name in ("__proto__", "prototype", "constructor") for name in names) or len(set(names)) != len(names) or item_type != "object" and columns:
                        raise ToolError("INVALID_PARAMS", "Le colonne devono essere univoche e sono ammesse solo per item object.")
                    if filter_config is not None:
                        if not isinstance(filter_config, dict) or filter_config.get("column") not in (names if item_type == "object" else ["$item"]):
                            raise ToolError("INVALID_PARAMS", "Il filtro loop.forEach indica una colonna non dichiarata.")
                        operator = filter_config.get("operator")
                        if operator not in ("eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull"):
                            raise ToolError("INVALID_PARAMS", "Operatore filtro loop.forEach non supportato.")
                        column_type = item_type if filter_config["column"] == "$item" else next((column.get("type") for column in columns if column.get("name") == filter_config["column"]), None)
                        if operator in ("gt", "gte", "lt", "lte") and column_type != "number": raise ToolError("INVALID_PARAMS", f"L'operatore {operator} richiede una colonna number.")
                        if operator in ("startsWith", "endsWith") and column_type != "string": raise ToolError("INVALID_PARAMS", f"L'operatore {operator} richiede una colonna string.")
                        if operator in ("contains", "notContains") and column_type not in ("string", "array"): raise ToolError("INVALID_PARAMS", f"L'operatore {operator} richiede una colonna string o array.")
                        if operator in ("in", "notIn") and not isinstance(filter_config.get("value"), list): raise ToolError("INVALID_PARAMS", f"L'operatore {operator} richiede value come array.")
                    for item in source_items: _validate_for_each_item(item, item_type, columns)
                    indexed_items = [(index, item) for index, item in enumerate(source_items) if filter_config is None or _for_each_value_matches(item, filter_config)]
                    body_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "body"]
                    while pending:
                        current = pending.pop()
                        if current in body_ids: continue
                        body_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    after_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "after"]
                    while pending:
                        current = pending.pop()
                        if current in after_ids: continue
                        after_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    body_ids -= after_ids
                    if not body_ids: raise ToolError("INVALID_GRAPH", "Collega almeno un nodo al ramo body del ciclo.")
                    verify_loop_region(node_id, body_ids, after_ids)
                    body_nodes = [item for item in nodes if item.get("id") in body_ids]
                    body_edges = [edge for edge in edges if edge.get("target") in body_ids]
                    completed_body.update(body_ids)
                    loop_value: dict[str, Any] = {"items": source_items, "count": len(indexed_items), "body": {"active": True}}
                    values[node_id] = loop_value
                    loop_frame: dict[str, Any] = {}
                    for iteration, (source_index, item) in enumerate(indexed_items):
                        context.check()
                        if iteration >= limit: raise ToolError("ITERATION_LIMIT", f"Il ciclo richiede un'altra iterazione, oltre maxIterations={limit}.")
                        if iteration_budget[0] <= 0: raise ToolError("ITERATION_LIMIT", "Il workflow ha superato il limite totale di 10000 iterazioni.")
                        iteration_budget[0] -= 1
                        loop_scope = {"item": item, "index": source_index, "_loopId": node_id}
                        loop_value.update({"item": item, "index": source_index})
                        for body_id in body_ids: values.pop(body_id, None)
                        report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": int(iteration * 100 / max(1, len(indexed_items))), "output": {"index": source_index, "iteration": iteration + 1, "count": len(indexed_items), "maxIterations": limit}})
                        body_result = self.execute({"nodes": body_nodes, "edges": body_edges}, api_input, input_files, context, report_step, heartbeat, _values=values, _loop_scope=loop_scope, _internal=True, _depth=_depth + 1, _deferred_deletions=deferred_deletions, _deferred_bookmarks=deferred_bookmarks, _variables=variables, _iteration_budget=iteration_budget, _control_flow=control_flow, _variable_frames=[*variable_frames, loop_frame])
                        pages += body_result.get("pagesProcessed", 0)
                        completed_body.update(body_ids)
                        context.check()
                        heartbeat(int((position + (iteration + 1) / max(1, len(indexed_items))) / max(1, len(order)) * 95), node_id, pages)
                        transfer = body_result.get("controlTransfer")
                        if transfer is not None:
                            if transfer.get("loopNodeId") != node_id: raise ToolError("INVALID_CONTROL_FLOW", "Il trasferimento non appartiene al loop.forEach corrente.")
                            if transfer.get("kind") == "break": break
                            if transfer.get("kind") != "continue": raise ToolError("INVALID_CONTROL_FLOW", "Trasferimento non supportato in loop.forEach.")
                    loop_value.update({"after": {"active": True}, "success": {"active": True}})
                    result = ToolResult(dict(loop_value), 0)
                elif tool_id in ("loop.while", "loop.repeatUntil"):
                    if _depth >= 4: raise ToolError("LOOP_DEPTH", "I cicli annidati superano la profondità massima (4).")
                    condition = raw_parameters.get("condition")
                    limit = raw_parameters.get("maxIterations")
                    timeout_seconds = raw_parameters.get("timeoutSeconds", 900)
                    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
                        raise ToolError("INVALID_PARAMS", f"{tool_id} richiede maxIterations intero tra 1 e 1000.")
                    if not isinstance(timeout_seconds, int) or isinstance(timeout_seconds, bool) or not 1 <= timeout_seconds <= 900:
                        raise ToolError("INVALID_PARAMS", f"{tool_id} timeoutSeconds deve essere compreso tra 1 e 900.")
                    body_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "body"]
                    while pending:
                        current = pending.pop()
                        if current in body_ids: continue
                        body_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    after_ids: set[str] = set(); pending = [edge["target"] for edge in edges if edge.get("source") == node_id and edge.get("sourceHandle") == "after"]
                    while pending:
                        current = pending.pop()
                        if current in after_ids: continue
                        after_ids.add(current)
                        pending.extend(edge["target"] for edge in edges if edge.get("source") == current)
                    body_ids -= after_ids
                    if not body_ids: raise ToolError("INVALID_GRAPH", "Collega almeno un nodo al ramo body del ciclo.")
                    verify_loop_region(node_id, body_ids, after_ids)
                    body_nodes = [item for item in nodes if item.get("id") in body_ids]
                    body_edges = [edge for edge in edges if edge.get("target") in body_ids]
                    completed_body.update(body_ids)
                    loop_value: dict[str, Any] = {"iteration": 0, "body": {"active": True}}
                    values[node_id] = loop_value
                    loop_frame: dict[str, Any] = {}
                    started = time.monotonic(); iterations = 0

                    def check_loop_condition(completed: int) -> bool:
                        context.check()
                        if time.monotonic() - started >= timeout_seconds:
                            raise ToolError("LOOP_TIMEOUT", f"{tool_id} ha superato il timeout di {timeout_seconds} secondi.")
                        context.binding_resolver = lambda value: _substitute(value, api_input, values, variables, {**(_loop_scope or {}), "iteration": completed}, variable_frames)
                        try:
                            condition_result = self.registry.get("logic.conditionGroup", "1.0.0")(context, {}, {"condition": condition})
                            return condition_result.outputs.get("boolean") is True
                        finally:
                            context.binding_resolver = None

                    def execute_iteration(iteration: int) -> dict[str, Any]:
                        nonlocal pages
                        context.check()
                        if time.monotonic() - started >= timeout_seconds:
                            raise ToolError("LOOP_TIMEOUT", f"{tool_id} ha superato il timeout di {timeout_seconds} secondi.")
                        if iteration_budget[0] <= 0: raise ToolError("ITERATION_LIMIT", "Il workflow ha superato il limite totale di 10000 iterazioni.")
                        iteration_budget[0] -= 1
                        loop_scope = {**(_loop_scope or {}), "iteration": iteration, "_loopId": node_id}
                        loop_value["iteration"] = iteration
                        for body_id in body_ids: values.pop(body_id, None)
                        report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": min(99, int((iteration - 1) * 100 / limit)), "output": {"iteration": iteration, "maxIterations": limit, "phase": "body"}})
                        body_result = self.execute({"nodes": body_nodes, "edges": body_edges}, api_input, input_files, context, report_step, heartbeat, _values=values, _loop_scope=loop_scope, _internal=True, _depth=_depth + 1, _deferred_deletions=deferred_deletions, _deferred_bookmarks=deferred_bookmarks, _variables=variables, _iteration_budget=iteration_budget, _control_flow=control_flow, _variable_frames=[*variable_frames, loop_frame])
                        pages += body_result.get("pagesProcessed", 0)
                        completed_body.update(body_ids)
                        context.check()
                        if time.monotonic() - started >= timeout_seconds:
                            raise ToolError("LOOP_TIMEOUT", f"{tool_id} ha superato il timeout di {timeout_seconds} secondi.")
                        heartbeat(int((position + min(iteration / limit, 0.99)) / max(1, len(order)) * 95), node_id, pages)
                        return body_result

                    if tool_id == "loop.while":
                        while check_loop_condition(iterations):
                            if iterations >= limit: raise ToolError("ITERATION_LIMIT", f"{tool_id} condizione ancora vera dopo maxIterations={limit}.")
                            iterations += 1
                            body_result = execute_iteration(iterations)
                            transfer = body_result.get("controlTransfer")
                            if transfer is not None:
                                if transfer.get("loopNodeId") != node_id: raise ToolError("INVALID_CONTROL_FLOW", "Il trasferimento non appartiene al loop.while corrente.")
                                if transfer.get("kind") == "break": break
                                if transfer.get("kind") != "continue": raise ToolError("INVALID_CONTROL_FLOW", "Trasferimento non supportato in loop.while.")
                    else:
                        while True:
                            if iterations >= limit: raise ToolError("ITERATION_LIMIT", f"{tool_id} condizione non raggiunta entro maxIterations={limit}.")
                            iterations += 1
                            body_result = execute_iteration(iterations)
                            transfer = body_result.get("controlTransfer")
                            if transfer is not None:
                                if transfer.get("loopNodeId") != node_id: raise ToolError("INVALID_CONTROL_FLOW", "Il trasferimento non appartiene al loop.repeatUntil corrente.")
                                if transfer.get("kind") == "break": break
                                if transfer.get("kind") != "continue": raise ToolError("INVALID_CONTROL_FLOW", "Trasferimento non supportato in loop.repeatUntil.")
                            if check_loop_condition(iterations): break
                    loop_value.update({"iteration": iterations, "after": {"active": True}, "success": {"active": True}})
                    result = ToolResult(dict(loop_value), 0)
                elif tool_id == "pdf.page.delete" and _loop_scope is not None:
                    selectors = [key for key in ("page", "pages", "pageId") if key in parameters]
                    if len(selectors) != 1: raise ToolError("INVALID_PARAMS", "Specificare esattamente uno tra page, pages e pageId.")
                    selector = selectors[0]; total_pages = int(_loop_scope.get("_pageCount", 0))
                    if selector == "page": selected_values = [parameters["page"]]
                    elif selector == "pages": selected_values = parameters["pages"]
                    else: selected_values = [parameters["pageId"]]
                    if selector in {"page", "pages"}:
                        if selector == "pages" and (not isinstance(selected_values, list) or not 1 <= len(selected_values) <= 1000): raise ToolError("INVALID_PARAMS", "pages deve contenere da 1 a 1000 numeri di pagina.")
                        if any(not isinstance(page, int) or isinstance(page, bool) for page in selected_values): raise ToolError("INVALID_PARAMS", "I riferimenti di pagina devono essere interi 1-based.")
                        selected_pages = set(selected_values)
                    else:
                        page_id = selected_values[0]
                        match = re.fullmatch(r"([a-f0-9]{16}):page:([1-9][0-9]*)", page_id) if isinstance(page_id, str) else None
                        current_id = str(_loop_scope.get("pageId", ""))
                        if not match or not current_id.startswith(f"{match.group(1)}:page:"): raise ToolError("PAGE_IDENTITY_LOST", "pageId non appartiene alla fotografia pagine di questo loop.")
                        selected_pages = {int(match.group(2))}
                    if any(page < 1 or page > total_pages for page in selected_pages): raise ToolError("INVALID_PARAMS", f"Un riferimento di pagina è fuori documento (1–{total_pages}).")
                    current_page = int(_loop_scope["currentPage"]); should_delete = current_page in selected_pages
                    if should_delete: deferred_deletions.setdefault(str(_loop_scope.get("_loopId", "")), set()).add(current_page)
                    source = tool_inputs.get("pdf")
                    if isinstance(source, list): source = source[0] if source else None
                    result = ToolResult({"pdf": source, "deletedPages": [current_page] if should_delete else [], "deletedPageIds": [_loop_scope["pageId"]] if should_delete else []}, 0)
                elif tool_id == "pdf.delete-pages" and _loop_scope is not None:
                    selected = parameters.get("pages", [])
                    delete_current = parameters.get("deleteCurrentPage") is True
                    should_delete = delete_current or isinstance(selected, list) and _loop_scope["currentPage"] in selected
                    if should_delete:
                        deferred_deletions.setdefault(str(_loop_scope.get("_loopId", "")), set()).add(int(_loop_scope["currentPage"]))
                    source = tool_inputs.get("pdf")
                    if isinstance(source, list): source = source[0] if source else None
                    result = ToolResult({"pdf": source, "deletedPageIds": [_loop_scope["pageId"]] if should_delete else []}, 0)
                elif tool_id == "pdf.bookmark.add" and _loop_scope is not None and isinstance(_loop_scope.get("_pageCount"), int):
                    page = parameters.get("page")
                    description = parameters.get("description")
                    level = parameters.get("level", 0)
                    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= _loop_scope["_pageCount"]:
                        raise ToolError("INVALID_PARAMS", f"page deve indicare una pagina originale tra 1 e {_loop_scope['_pageCount']}.")
                    if not isinstance(description, str) or not description.strip() or len(description.strip()) > 500:
                        raise ToolError("INVALID_PARAMS", "description deve contenere da 1 a 500 caratteri.")
                    if level != 0 or parameters.get("parent") is not None:
                        raise ToolError("INVALID_PARAMS", "Nel body di loop.eachPage i segnalibri devono essere di livello 0 e senza parent.")
                    deferred_bookmarks.setdefault(str(_loop_scope.get("_loopId", "")), []).append({"page": page, "description": description.strip()})
                    result = ToolResult({"pdf": tool_inputs.get("pdf")}, 0)
                elif tool_id in ("pdf.output", "pdf.output.apiName"):
                    candidate = tool_inputs.get("document")
                    if isinstance(candidate, list): candidate = next((item for item in candidate if isinstance(item, str) and Path(item).is_file()), None)
                    if not isinstance(candidate, str) or not Path(candidate).is_file():
                        raise ToolError("MISSING_INPUT", "Il nodo pdf.output richiede un PDF collegato alla porta document.")
                    content_type = parameters.get("contentType", "application/pdf")
                    policy = parameters.get("collisionPolicy", "rename")
                    api_filename = tool_id == "pdf.output.apiName"
                    template = parameters.get("filename") if api_filename else parameters.get("filenameTemplate", "{basename}.pdf")
                    allowed = {"basename", "nodeId", "index"}
                    if content_type != "application/pdf": raise ToolError("INVALID_PARAMS", "pdf.output accetta soltanto contentType application/pdf.")
                    if policy not in {"error", "rename", "overwrite"}: raise ToolError("INVALID_PARAMS", "collisionPolicy deve essere error, rename o overwrite.")
                    if not isinstance(template, str) or not 1 <= len(template) <= 255 or "/" in template or "\\" in template or ".." in template or not template.lower().endswith(".pdf"):
                        raise ToolError("INVALID_PARAMS", "Il nome deve essere un file PDF sicuro, senza percorsi.")
                    if not api_filename:
                        placeholders = re.findall(r"\{([^{}]+)\}", template)
                        if any(name not in allowed for name in placeholders) or re.search(r"\{[^{}]*\}", re.sub(r"\{(?:basename|nodeId|index)\}", "", template)):
                            raise ToolError("INVALID_PARAMS", "Placeholder ammessi: {basename}, {nodeId}, {index}.")
                    source_path = str(Path(candidate).resolve())
                    original_name = context.source_filenames.get(source_path, Path(candidate).name)
                    basename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._-") or "document"
                    rendered = template if api_filename else template.replace("{basename}", basename).replace("{nodeId}", re.sub(r"[^A-Za-z0-9_-]+", "_", node_id)).replace("{index}", str(len(outputs) + 1))
                    # Hashes and lengths are derived from the worker file; client metadata is never trusted.
                    registered = _register_output(outputs, {"path": candidate, "filename": rendered, "contentType": content_type, "collisionPolicy": policy, "nodeId": node_id})
                    manifest_entry = _artifact_manifest(candidate, registered["filename"], content_type)
                    artifact = {key: value for key, value in manifest_entry.items() if key != "filename"}
                    artifact["filename"] = registered["filename"]
                    result = ToolResult({"artifact": artifact, "manifest": {"count": 1, "totalBytes": manifest_entry["sizeBytes"], "files": [manifest_entry]}}, len(context.pdf(candidate).pages))
                elif tool_id == "output.pdf":
                    documents = tool_inputs.get("documents")
                    if isinstance(documents, list):
                        if not documents:
                            raise ToolError("MISSING_INPUT", "L'input documents del nodo output.pdf è vuoto.")
                        output_documents = []
                        total_output_pages = 0
                        for item in documents:
                            path = item.get("path") if isinstance(item, dict) else item
                            if not isinstance(path, str) or not Path(path).is_file():
                                raise ToolError("MISSING_INPUT", "Uno dei documenti collegati all'output non è disponibile.")
                            page_count = len(context.pdf(path).pages)
                            total_output_pages += page_count
                            raw_filename = item.get("filename") if isinstance(item, dict) else None
                            filename = Path(str(raw_filename or Path(path).name)).name
                            registered = _register_output(outputs, {"path": path, "filename": filename, "contentType": "application/pdf", "nodeId": node_id})
                            output_documents.append({"path": path, "filename": registered["filename"]})
                        result = ToolResult({"documents": output_documents}, total_output_pages)
                    else:
                        candidate = tool_inputs.get("pdf", next(iter(tool_inputs.values()), None))
                        if isinstance(candidate, list): candidate = next((item for item in candidate if isinstance(item, str) and Path(item).is_file()), None)
                        if not isinstance(candidate, str) or not Path(candidate).is_file(): raise ToolError("MISSING_INPUT", "Il nodo output.pdf richiede un PDF collegato.")
                        filename = parameters.get("filename") or f"{data.get('label', 'output')}.pdf"
                        if not isinstance(filename, str) or not filename.lower().endswith(".pdf") or Path(filename).name != filename or ".." in filename or "/" in filename or "\\" in filename:
                            raise ToolError("INVALID_PARAMS", "filename deve essere un nome file PDF senza percorsi.")
                        _register_output(outputs, {"path": candidate, "filename": filename, "contentType": "application/pdf", "nodeId": node_id})
                        result = ToolResult({"pdf": candidate}, len(context.pdf(candidate).pages))
                else:
                    function = self.registry.get(handler_id, version)
                    context.timeout_seconds = min(max_tool_timeout, int(compiled.get("timeoutSeconds", self.registry.timeout(handler_id, version))) if isinstance(compiled, dict) else self.registry.timeout(handler_id, version))
                    if tool_id == "flow.condition": parameters["apiParameters"] = api_input
                    context.progress = lambda done, total: (report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": int(done * 100 / max(1, total)), "attempts": step_attempt}), heartbeat(int(position / max(1, len(order)) * 95), node_id, pages))
                    for step_attempt in range(1, 4):
                        report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": 0, "input": _safe(tool_inputs), "attempts": step_attempt})
                        context._started = time.monotonic()
                        try:
                            result = function(context, tool_inputs, parameters)
                            break
                        except ToolError as error:
                            if not error.retryable or not self.registry.idempotent(handler_id, version) or step_attempt == 3:
                                report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "FAILED", "progress": 0, "error": {"code": error.code, "message": str(error)}, "attempts": step_attempt})
                                if any(edge.get("source") == node_id and edge.get("sourceHandle") == "error" for edge in edges):
                                    result = ToolResult({"error": {"code": error.code, "message": str(error)}}, 0); handled_failure = True; break
                                raise
                            report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "RUNNING", "progress": 0, "event": "STEP_RETRY", "attempts": step_attempt})
                            time.sleep(2 ** (step_attempt - 1)); context.check()
                        except Exception as error:
                            report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "FAILED", "progress": 0, "error": {"code": "TOOL_ERROR", "message": str(error)[:1000]}, "attempts": step_attempt})
                            if any(edge.get("source") == node_id and edge.get("sourceHandle") == "error" for edge in edges):
                                result = ToolResult({"error": {"code": "TOOL_ERROR", "message": str(error)[:1000]}}, 0); handled_failure = True; break
                            raise
            values[node_id] = result.outputs; pages += result.pages_processed
            if handled_failure: values[node_id].setdefault("error", {"active": True})
            elif node_transfer is None: values[node_id].setdefault("success", {"active": True})
            report_step({"nodeId": node_id, "toolId": tool_id, "toolVersion": version, "status": "FAILED" if handled_failure else "SUCCEEDED", "progress": 100, "output": _safe(result.outputs)})
            heartbeat(int((position + 1) / max(1, len(order)) * 95), node_id, pages)
            if node_transfer is not None: pending_transfer = node_transfer
        if not _internal and not outputs:
            # A batch can return a tool result even when no explicit output node was added.
            for node_id in reversed(order):
                for port_value in values.get(node_id, {}).values():
                    if isinstance(port_value, list):
                        documents = [item for item in port_value if isinstance(item, dict) and isinstance(item.get("path"), str) and Path(item["path"]).is_file()]
                        if documents:
                            for item in documents:
                                _register_output(outputs, {"path": item["path"], "filename": Path(str(item.get("filename") or Path(item["path"]).name)).name, "contentType": item.get("contentType", "application/pdf"), "nodeId": node_id})
                            break
                    if isinstance(port_value, str) and port_value.lower().endswith(".pdf") and Path(port_value).is_file():
                        _register_output(outputs, {"path": port_value, "filename": "output.pdf", "contentType": "application/pdf", "nodeId": node_id}); break
                if outputs: break
        if not _internal and not outputs: raise ToolError("NO_OUTPUT", "Il flusso non ha prodotto un PDF.")
        return {"files": outputs, "pagesProcessed": pages, "steps": len(order), **({"controlTransfer": pending_transfer} if pending_transfer is not None else {})}


