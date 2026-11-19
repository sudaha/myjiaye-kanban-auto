# -*- coding: utf-8 -*-
"""从央采询价通知书 PDF 的采购需求表格完整提取每个品目的技术要求。

原则：
- PDF 表格的“技术要求”单元格是原文证据；不得摘要、缩减或用结构化属性替换。
- 同时保留商品属性要求、其他技术指标要求和完整原文。
- 跨页单元格按序号续接；只做 PDF 版面换行清理，不改写文字。
"""
from __future__ import print_function

import hashlib
import re

import fitz


PRODUCT_ATTR = "商品属性要求："
OTHER_TECH = "其他技术指标要求："


def _clean_cell(value):
    if value is None:
        return ""
    text = str(value).replace("\r", "\n").replace("\u00a0", " ")
    lines = [re.sub(r"[ \t]+", " ", x).strip() for x in text.split("\n")]
    return "\n".join(x for x in lines if x)


def _compact_layout_breaks(text):
    """仅合并 PDF 列宽造成的断行；标题/编号等语义边界保留。"""
    lines = [x.strip() for x in (text or "").split("\n") if x.strip()]
    out = ""
    for line in lines:
        if not out:
            out = line
            continue
        # 上一行以标点结束，或本行是新字段/新编号时保留换行；否则视为表格列宽折行。
        new_item = bool(re.match(r"^(?:商品属性要求：|其他技术指标要求：|\d+[、.．])", line))
        if out.endswith(("。", "；", ";", "：", ":")) or new_item:
            out += "\n" + line
        else:
            out += line
    # PDF 排版会在英文/数字和单位之间插入空格，只去除明显的中文夹空格，不删除有意义空格。
    out = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", out)
    out = re.sub(r"\s+([：，。；！？、])", r"\1", out)
    out = re.sub(r"(?<=\d)\s+(?=(?:个|台|条|米|年|页|张|W|K|G|T|M))", "", out)
    return out.strip()


def _header_span(full, label):
    """标题在 PDF 中可能被字间距拆开（如“商 品 属 性 要 求 ：”），返回 (start, end) 空格容忍匹配。"""
    pattern = r"\s*".join(re.escape(c) for c in label)
    m = re.search(pattern, full)
    return (m.start(), m.end()) if m else (-1, -1)


def _split_full(full):
    product_attr = ""
    other = ""
    a, ae = _header_span(full, PRODUCT_ATTR)
    b, be = _header_span(full, OTHER_TECH)
    if a >= 0:
        end = b if b > a else len(full)
        product_attr = full[ae:end].strip()
    if b >= 0:
        other = full[be:].strip()
    return product_attr, other


def _join_wrapped_attribute_values(product_attr):
    """把 PDF 行折断造成的“属性名:\n属性值”恢复为同一字段，不改写文字。"""
    if not product_attr:
        return product_attr
    lines = [x.strip() for x in product_attr.split("\n") if x.strip()]
    out = []
    for line in lines:
        if out and (out[-1].endswith(":") or out[-1].endswith("：")):
            out[-1] += line
        else:
            out.append(line)
    return "\n".join(out)


def _repair_clipped_attributes(product_attr, other):
    """用同品目“其他技术指标”中的完整重复值修复 PDF 表格边界裁字。

    仅在短值是后文完整术语的严格前缀时修复，并返回逐项修复证据；不凭常识补字。
    """
    repairs = []
    if not product_attr or not other:
        return product_attr, repairs
    fields = product_attr.split(",")
    for i, field in enumerate(fields):
        if ":" not in field and "：" not in field:
            continue
        sep = ":" if ":" in field else "："
        key, value = field.split(sep, 1)
        value = value.strip()
        compact = re.sub(r"\s+", "", value)
        if len(compact) < 4:
            continue
        # 后文完整术语：从相同前缀开始，最多多6个字母/数字/上标字符。
        other_compact = re.sub(r"\s+", "", other)
        m = re.search(re.escape(compact) + r"([A-Za-z0-9²³⁴⁵⁶⁷⁸⁹]{1,6})", other_compact, re.I)
        if not m:
            continue
        extra = m.group(1)
        repaired = value + extra
        fields[i] = key + sep + repaired
        repairs.append({"field": key.strip(), "from": value, "to": repaired,
                        "evidence": "同品目其他技术指标重复完整术语"})
    return ",".join(fields), repairs


def extract_pdf_requirements(pdf_path):
    """返回按表格序号排序的品目技术要求列表。"""
    doc = fitz.open(pdf_path)
    found = {}
    last_seq = None
    for page_no, page in enumerate(doc, 1):
        try:
            tables = page.find_tables().tables
        except Exception:
            tables = []
        for table in tables:
            rows = table.extract() or []
            if not rows:
                continue
            header = [_clean_cell(x) for x in rows[0]]
            tech_col = next((i for i, x in enumerate(header) if "技术要求" in x), None)
            product_col = next((i for i, x in enumerate(header) if "产品名称" in x), 2 if len(header) >= 3 else None)
            start = 1 if tech_col is not None else 0
            # 跨页续表通常没有表头，沿用九列表格的最后一列。
            if tech_col is None:
                if len(header) >= 9 and (last_seq is not None or any(PRODUCT_ATTR in _clean_cell(x) for x in header)):
                    tech_col = len(header) - 1
                    product_col = 2
                else:
                    continue
            for row in rows[start:]:
                cells = [_clean_cell(x) for x in row]
                if tech_col >= len(cells):
                    continue
                tech = cells[tech_col]
                seq_text = cells[0] if cells else ""
                seq_match = re.match(r"^\s*(\d+)\s*$", seq_text)
                if seq_match:
                    seq = int(seq_match.group(1))
                    last_seq = seq
                    item = found.setdefault(seq, {
                        "seq": seq,
                        "product_name_pdf": "",
                        "technical_parts": [],
                        "pages": [],
                    })
                    if product_col is not None and product_col < len(cells):
                        item["product_name_pdf"] = cells[product_col]
                    if tech:
                        item["technical_parts"].append(tech)
                        item["pages"].append(page_no)
                elif last_seq is not None and tech:
                    # 同一技术要求单元格跨页，前8列为空，最后一列是续文。
                    item = found[last_seq]
                    item["technical_parts"].append(tech)
                    item["pages"].append(page_no)
    doc.close()

    result = []
    for seq in sorted(found):
        item = found[seq]
        full_raw = "\n".join(item.pop("technical_parts")).strip()
        full_normalized = _compact_layout_breaks(full_raw)
        product_attr, other = _split_full(full_normalized)
        product_attr = _join_wrapped_attribute_values(product_attr)
        product_attr, repairs = _repair_clipped_attributes(product_attr, other)
        # 展示原文以 PDF 为主；存在有证据修复时，只替换商品属性段对应字段并保留修复日志。
        display_full = full_raw
        if repairs:
            raw_a = display_full.find(PRODUCT_ATTR)
            raw_b = display_full.find(OTHER_TECH)
            if raw_a >= 0 and raw_b > raw_a:
                display_full = display_full[:raw_a + len(PRODUCT_ATTR)] + product_attr + "\n" + display_full[raw_b:]
        item.update({
            # raw 是“规格/需求”直接展示证据；normalized 只给结构化解析使用。
            "technical_requirements_pdf_raw": display_full,
            "technical_requirements_full": display_full,
            "technical_requirements_normalized": PRODUCT_ATTR + product_attr + "\n" + OTHER_TECH + other,
            "product_attribute_requirements": product_attr,
            "pdf_text_repairs": repairs,
            "other_technical_requirements": other,
            "requirements_sha256": hashlib.sha256(display_full.encode("utf-8")).hexdigest(),
            "requirements_complete": bool(display_full and (product_attr or other)),
        })
        result.append(item)
    return result


def enrich_products_from_pdf(products, pdf_items):
    """按品目顺序回填；返回新列表和逐品目审计。"""
    enriched = []
    audit = []
    for index, product in enumerate(products):
        p = dict(product)
        pdf_item = pdf_items[index] if index < len(pdf_items) else None
        api_spec = p.get("specification") or ""
        p["specification_api"] = api_spec
        if pdf_item:
            full = pdf_item["technical_requirements_pdf_raw"]
            p["product_attribute_requirements"] = pdf_item["product_attribute_requirements"]
            p["other_technical_requirements"] = pdf_item["other_technical_requirements"]
            p["technical_requirements_pdf_raw"] = full
            p["technical_requirements_full"] = full
            p["technical_requirements_normalized"] = pdf_item["technical_requirements_normalized"]
            p["pdf_text_repairs"] = pdf_item.get("pdf_text_repairs") or []
            p["requirements_source"] = "pdf"
            p["requirements_pdf_pages"] = pdf_item["pages"]
            p["requirements_sha256"] = pdf_item["requirements_sha256"]
            p["requirements_complete"] = pdf_item["requirements_complete"]
            # 规格/需求展示字段必须是 PDF 完整技术要求原文，不使用 API 摘要。
            p["specification"] = full
        else:
            p["requirements_source"] = "api_only"
            p["requirements_complete"] = False
        enriched.append(p)
        audit.append({
            "index": index + 1,
            "product_name": p.get("productName") or "",
            "pdf_product_name": (pdf_item or {}).get("product_name_pdf") or "",
            "api_length": len(api_spec),
            "full_length": len(p.get("technical_requirements_full") or ""),
            "has_product_attributes": bool(p.get("product_attribute_requirements")),
            "has_other_technical": bool(p.get("other_technical_requirements")),
            "complete": bool(p.get("requirements_complete")),
        })
    return enriched, audit
