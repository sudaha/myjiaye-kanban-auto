/* ============================================================
 * docs_v3.js (part 1, v4) —— 通用模板引擎（xlsx）零修改原则：
 *  - 模板字节级保留：样式/行高/合并/列宽/多run富文本一律不动
 *  - token 值只填进含占位符的单元格：行内字符串原位替换；
 *    sharedStrings 模板按项追加 <si> 只改 <v> 索引
 *  - 唯一允许的样式变更：白字体单元格填值时克隆 font/xf 改黑
 *  - 行高：模板已有 ht 保持原样；无 ht（自适应）才按换行补
 * 依赖 window.Docs（docs.js：parseFree / wrapLines / todayBJ）
 * ============================================================ */
(function () {
  "use strict";
  var D = window.Docs || {};

  function escXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function unescXml(s) { return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
  function fmtMoney(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var ALIAS = {
    "客户": "customer", "客户名称": "customer", "CUSTOMER": "customer", "customer": "customer",
    "日期": "date", "DATE": "date", "date": "date",
    "联系人": "contact", "CONTACT": "contact", "contact": "contact",
    "电话": "phone", "PHONE": "phone", "phone": "phone",
    "邮箱": "email", "EMAIL": "email", "email": "email",
    "备注": "remarks", "REMARKS": "remarks", "remarks": "remarks",
    "总数": "total", "TOTAL": "total", "total": "total",
    "序号": "no", "NO": "no",
    "名称": "name", "NAME": "name",
    "型号": "model", "MODEL": "model",
    "规格": "spec", "SPEC": "spec",
    "数量": "qty", "QTY": "qty",
    "单位": "unit", "UNIT": "unit",
    "单价": "price", "PRICE": "price",
    "行合计": "itemtotal", "TOTAL_ITEM": "itemtotal"
  };
  var TOKEN_RE = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
  function tokensOf(text) {
    var out = [], m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text)))) { if (ALIAS[m[1]]) out.push(ALIAS[m[1]]); }
    return out;
  }
  function replaceTokens(text, map) {
    return String(text).replace(TOKEN_RE, function (all, name) {
      var k = ALIAS[name];
      if (k && map[k] !== undefined) return String(map[k]);
      return all;
    });
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var out = [], m, re = /<si>([\s\S]*?)<\/si>/g;
    while ((m = re.exec(xml))) {
      var t = "", mm, tr = /<t[^>]*>([\s\S]*?)<\/t>/g;
      while ((mm = tr.exec(m[1]))) t += mm[1];
      out.push(unescXml(t));
    }
    return out;
  }

  function colWidths(xml) {
    var w = {}, m, re = /<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"[^>]*\bwidth="([\d.]+)"[^>]*\/?>/g;
    while ((m = re.exec(xml))) {
      var a = +m[1], b = +m[2];
      for (var c = a; c <= b && c <= 26; c++) w[String.fromCharCode(64 + c)] = parseFloat(m[3]);
    }
    return w;
  }

  /* ---------- 白字体检测（styles.xml） ---------- */
  function whiteFontIds(stylesXml) {
    var fonts = stylesXml.match(/<font>[\s\S]*?<\/font>/g) || [];
    var set = {};
    fonts.forEach(function (f, i) {
      var m = f.match(/<color\b[^>]*\brgb="([^"]+)"/);
      if (m && /^F{6}$/i.test(m[1].slice(-6))) set[i] = true;
    });
    return set;
  }
  function whiteXfs(stylesXml, wFonts) {
    var sec = stylesXml.match(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/);
    var set = {};
    if (sec) (sec[0].match(/<xf\b[^>]*\/?>/g) || []).forEach(function (xf, i) {
      var fid = +((xf.match(/\bfontId="(\d+)"/) || [])[1] || 0);
      if (wFonts[fid]) set[i] = true;
    });
    return set;
  }

  /* ---------- 主构建（v4 零修改） ---------- */
  // 入参 stylesXml 可为空；返回 { sheetXml, ssXml, stylesXml }
  function buildXlsxXml(sheetXml, ssXml, stylesXml, p, kind) {
    stylesXml = stylesXml || "";
    var ss = parseSharedStrings(ssXml);
    var ssOut = ssXml || "";
    var wXfs = stylesXml ? whiteXfs(stylesXml, whiteFontIds(stylesXml)) : {};
    var stylesOut = stylesXml;
    var variants = {};
    var ssAdded = 0;

    function appendSi(text) {
      if (!ssXml) return -1;
      var idx = ss.length + ssAdded;
      var si = '<si><t xml:space="preserve">' + escXml(text) + "</t></si>";
      ssOut = ssOut.replace(/<\/sst>/, si + "</sst>");
      var total = ss.length + ssAdded + 1;
      ssOut = ssOut.replace(/(<sst\b[^>]*\bcount=")\d+(")/, function (m, a, b) { return a + total + b; });
      ssOut = ssOut.replace(/uniqueCount="\d+"/, 'uniqueCount="' + total + '"');
      ssAdded++;
      return idx;
    }
    // 白字单元格 → 克隆 font/xf 改黑（唯一允许的样式变更）
    function blackVariant(xfIdx) {
      if (!stylesXml || variants[xfIdx]) return variants[xfIdx] ? variants[xfIdx].idx : xfIdx;
      var fonts = stylesOut.match(/<font>[\s\S]*?<\/font>/g) || [];
      var xfSec = stylesOut.match(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/) || [];
      var xfs = xfSec[0] ? (xfSec[0].match(/<xf\b[^>]*\/?>/g) || []) : [];
      var xfStr = xfs[xfIdx] || "";
      var fid = +((xfStr.match(/\bfontId="(\d+)"/) || [])[1] || 0);
      var srcFont = fonts[fid] || fonts[fonts.length - 1] || "<font><sz val=\"11\"/><name val=\"宋体\"/></font>";
      var newFont = srcFont.replace(/<color\b[^>]*\/>/, '<color rgb="FF000000"/>')
                           .replace(/<color\b[^>]*rgb="F{6}"\s*\/>/i, '<color rgb="FF000000"/>');
      var newFontId = fonts.length;
      var newXf = xfStr.replace(/\bfontId="\d+"/, 'fontId="' + newFontId + '"');
      var newIdx = xfs.length;
      stylesOut = stylesOut
        .replace(/(<fonts count=")\d+(")/, function (m, a, b) { return a + (newFontId + 1) + b; })
        .replace("</fonts>", newFont + "</fonts>")
        .replace(/(<cellXfs count=")\d+(")/, function (m, a, b) { return a + (newIdx + 1) + b; })
        .replace("</cellXfs>", newXf + "</cellXfs>");
      variants[xfIdx] = { idx: newIdx };
      return newIdx;
    }

    var n = p.items.length;
    if (!n) throw new Error("没有可填入的产品行");
    var delta = 0; // 检出母版原有产品行数量后再计算

    var total = 0;
    p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
    var scalar = {
      customer: p.fields.customer || "", date: p.fields.date || (D.todayBJ ? D.todayBJ() : ""),
      contact: p.fields.contact || "", phone: p.fields.phone || "",
      email: p.fields.email || "", remarks: p.fields.remarks || "", total: fmtMoney(total)
    };
    var rowVals = p.items.map(function (it, i) {
      return {
        no: String(i + 1), name: it.name || "", model: it.model || "", spec: it.spec || "",
        qty: String(it.qty != null ? it.qty : ""), unit: it.unit || "",
        price: it.price != null ? fmtMoney(it.price) : "",
        itemtotal: it.price != null ? fmtMoney((it.qty || 0) * it.price) : ""
      };
    });

    // 行/格解析（仅定位用，不重建）
    var rows = {};
    (sheetXml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rx) {
      var r = +((rx.match(/\br="(\d+)"/) || [])[1]);
      if (r) rows[r] = rx;
    });
    var rList = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });

    function cellsOf(rx, rOverride) {
      var out = [], cm, cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while ((cm = cre.exec(rx))) {
        var ca = cm[1] || "", cb = cm[2] || "";
        var refM = ca.match(/\br="([A-Z]+)(\d+)"/);
        var ref = refM ? refM[1] + (rOverride || refM[2]) : "";
        var s = ((ca.match(/\bs="(\d+)"/) || [])[1]) || "";
        var t = ((ca.match(/\bt="([^"]+)"/) || [])[1]) || "";
        var v = "", vv = null;
        var is = cb.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
        if (is) v = unescXml(is[1]);
        else { vv = cb.match(/<v>([\s\S]*?)<\/v>/); if (vv) v = unescXml(vv[1]); }
        if (t === "s" && v !== "") v = (ss[+v] !== undefined) ? ss[+v] : v;
        out.push({ ref: ref, s: s, t: t, idx: vv ? vv[1] : "", text: v });
      }
      return out;
    }
    var productRow = -1, fallback = -1;
    for (var ri = 0; ri < rList.length; ri++) {
      var cs = cellsOf(rows[rList[ri]]);
      var hasN = false, hasQ = false;
      cs.forEach(function (c) {
        var tk = tokensOf(c.text);
        if (tk.indexOf("name") >= 0) hasN = true;
        if (tk.indexOf("qty") >= 0) hasQ = true;
      });
      if (hasN && hasQ) { productRow = rList[ri]; break; }
      if (hasN && fallback < 0) fallback = rList[ri];
    }
    if (productRow < 0) productRow = fallback;
    if (productRow < 0) throw new Error("模板未找到产品行（需有一行包含 {名称} 占位符，建议同时含 {数量}）");

    // 连续 token 产品行均属于母版容量（原始报价单为 9-11 共3行）
    var productRows = [];
    for (var pr = productRow; rows[pr]; pr++) {
      var pcs = cellsOf(rows[pr]), pHasN = false, pHasQ = false;
      pcs.forEach(function (c) {
        var tk = tokensOf(c.text);
        if (tk.indexOf("name") >= 0) pHasN = true;
        if (tk.indexOf("qty") >= 0) pHasQ = true;
      });
      if (!pHasN || !pHasQ) break;
      productRows.push(pr);
    }
    if (!productRows.length) productRows = [productRow];
    var productEnd = productRows[productRows.length - 1];
    var capacity = productRows.length;
    var outputProductRows = Math.max(n, capacity);
    delta = outputProductRows - capacity;

    var widths = colWidths(sheetXml);
    var protoRow = rows[productEnd]; // 扩容时只复制母版最后一个产品行
    var protoCells = cellsOf(protoRow);

    // 行 XML 工具
    function renumRow(rx, oldR, newR) {
      return rx
        .replace(/(<row\b[^>]*)\br="\d+"/, function (m, pre) { return pre.replace(/\s+$/, "") + ' r="' + newR + '"'; })
        .replace(/\br="([A-Z]{1,2})\d+"/g, function (m, L) { return 'r="' + L + newR + '"'; });
    }
    function cellSeg(rowXml, ref) {
      var m = rowXml.match(new RegExp('<c\\b[^>]*\\br="' + ref + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)'));
      return m ? m[0] : null;
    }
    function patchCellV(rowXml, ref, oldIdx, newIdx) {
      var seg = cellSeg(rowXml, ref);
      if (!seg) return rowXml;
      return rowXml.replace(seg, seg.replace("<v>" + oldIdx + "</v>", "<v>" + newIdx + "</v>"));
    }
    function patchCellS(rowXml, ref, newS) {
      var seg = cellSeg(rowXml, ref);
      if (!seg) return rowXml;
      var ns = /\bs="\d+"/.test(seg) ? seg.replace(/\bs="\d+"/, 's="' + newS + '"') : seg.replace(/(<c\b)/, '$1 s="' + newS + '" ');
      return rowXml.replace(seg, ns);
    }
    // 行内 token 原位替换（保留多 run 富文本）
    function fillRowTokens(rowXml, cells, map) {
      var out = rowXml;
      cells.forEach(function (c) {
        if (!c.ref || !tokensOf(c.text).length) return;
        var newVal = replaceTokens(c.text, map);
        var sAttr = c.s;
        if (wXfs[c.s]) sAttr = String(blackVariant(+c.s));
        if (c.t === "s") {
          // sharedStrings 格：原位转为 inlineStr 填入（WPS 对手写包追加 si 兼容性差；
          // 不触碰 sharedStrings.xml，其余模板字节保持原样）
          var seg = cellSeg(out, c.ref);
          if (seg) {
            var rep = '<c r="' + c.ref + '"' + (sAttr ? ' s="' + sAttr + '"' : "") +
              ' t="inlineStr"><is><t xml:space="preserve">' + escXml(newVal) + "</t></is></c>";
            out = out.replace(seg, rep);
          }
          return;
        }
        if (out.indexOf(escXml(c.text)) >= 0) {
          out = out.replace(escXml(c.text), escXml(newVal));
          if (sAttr !== c.s) out = patchCellS(out, c.ref, sAttr);
          return;
        }
        // 完整字面量未找到：按 raw token 名逐个替换（多 run 被拆开的情况）
        var nameSet = {}, mm, re2 = TOKEN_RE;
        re2.lastIndex = 0;
        while ((mm = re2.exec(c.text))) nameSet[mm[1]] = true;
        var allLit = true;
        Object.keys(nameSet).forEach(function (nm) { if (out.indexOf("{" + nm + "}") < 0) allLit = false; });
        if (allLit) {
          Object.keys(nameSet).forEach(function (nm) {
            out = out.split("{" + nm + "}").join(escXml(map[ALIAS[nm]] !== undefined ? String(map[ALIAS[nm]]) : ""));
          });
        } else {
          // token 跨 run 被拆散：整格重建（保留首 run rPr）
          var seg2 = cellSeg(out, c.ref);
          if (seg2) {
            var rpr = (seg2.match(/<rPr>[\s\S]*?<\/rPr>/) || [""])[0];
            var ns2 = wXfs[c.s] ? String(blackVariant(+c.s)) : (c.s || "0");
            var cell = '<c r="' + c.ref + '" s="' + ns2 + '" t="inlineStr"><is><r>' + rpr +
              '<t xml:space="preserve">' + escXml(newVal) + "</t></r></is></c>";
            out = out.replace(seg2, cell);
            return;
          }
        }
        if (sAttr !== c.s) out = patchCellS(out, c.ref, sAttr);
      });
      return out;
    }

    // 组装
    var outRows = [];
    var maxR = 0, maxColL = "";
    function trackCol(ref) {
      var L = (ref || "").replace(/\d+$/, "");
      if (L.length > maxColL.length || (L.length === maxColL.length && L > maxColL)) maxColL = L;
    }
    // 1) 顶部行：标量原位替换
    rList.forEach(function (r) {
      if (r >= productRow) return;
      var rx = rows[r];
      var cells = cellsOf(rx);
      cells.forEach(function (c) { if (c.ref) trackCol(c.ref); });
      outRows.push(fillRowTokens(rx, cells, scalar));
    });
    // 2) 产品区：母版原有格数全部保留；不足时留空，超出时只复制母版最后一个产品行
    var emptyVals = { no: "", name: "", model: "", spec: "", qty: "", unit: "", price: "", itemtotal: "" };
    for (var i = 0; i < outputProductRows; i++) {
      var nr = productRow + i;
      var sourceR = i < capacity ? productRows[i] : productEnd;
      var sourceRow = rows[sourceR];
      var sourceCells = cellsOf(sourceRow);
      var clone = sourceR === nr ? sourceRow : renumRow(sourceRow, sourceR, nr);
      var cList = sourceCells.map(function (c) {
        return { ref: c.ref.replace(/\d+$/, String(nr)), s: c.s, t: c.t, idx: c.idx, text: c.text };
      });
      clone = fillRowTokens(clone, cList, i < n ? rowVals[i] : emptyVals);
      outRows.push(clone);
      if (nr > maxR) maxR = nr;
    }
    // 3) 底部行：仅在扩容时整体下移；原属性与标量位置保持
    rList.forEach(function (r) {
      if (r <= productEnd) return;
      var nr = r + delta;
      var rx = delta ? renumRow(rows[r], r, nr) : rows[r];
      var cells = cellsOf(rows[r], nr);
      cells.forEach(function (c) { if (c.ref) trackCol(c.ref); });
      outRows.push(fillRowTokens(rx, cells, scalar));
      if (nr > maxR) maxR = nr;
    });
    // 顶部行也计入 maxR（n 很小时）
    rList.forEach(function (r) { if (r < productRow && r > maxR) maxR = r; });

    var newSheet = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, "<sheetData>" + outRows.join("") + "</sheetData>");

    // 合并单元格：母版产品区原合并全部保留；扩容复制最后产品行的合并；底部整体下移
    var merges = [], m, protoMerges = [], mre = /<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"/g;
    while ((m = mre.exec(sheetXml))) {
      var parts = m[1].split(":");
      var r1 = +parts[0].replace(/[A-Z]/g, ""), r2 = +parts[1].replace(/[A-Z]/g, "");
      if (r1 === productEnd && r2 === productEnd) protoMerges.push(m[1]);
      if (r1 > productEnd) {
        merges.push(parts[0].replace(r1, r1 + delta) + ":" + parts[1].replace(r2, r2 + delta));
      } else merges.push(m[1]);
    }
    for (var k = capacity; k < outputProductRows; k++) {
      var newR = productRow + k;
      protoMerges.forEach(function (ref) {
        var pp = ref.split(":");
        merges.push(pp[0].replace(productEnd, newR) + ":" + pp[1].replace(productEnd, newR));
      });
    }
    newSheet = newSheet.replace(/<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
      '<mergeCells count="' + merges.length + '">' + merges.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join("") + "</mergeCells>");

    var lastR = Math.max(maxR, (rList[rList.length - 1] || productEnd) + ((rList[rList.length - 1] || 0) > productEnd ? delta : 0));
    newSheet = newSheet.replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:' + (maxColL || "J") + lastR + '"');

    return { sheetXml: newSheet, ssXml: ssOut, stylesXml: stylesOut };
  }

  function detectXlsx(sheetXml, ss) {
    var rows = {};
    (sheetXml.match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) || []).forEach(function (rx) {
      var r = +((rx.match(/\br="(\d+)"/) || [])[1]);
      if (r) rows[r] = rx;
    });
    var found = -1;
    Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      if (found >= 0) return;
      var hasN = false, hasQ = false, cm, cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while ((cm = cre.exec(rows[r]))) {
        var t = ((cm[1].match(/\bt="([^"]+)"/) || [])[1]) || "";
        var v = (cm[2] || "").match(/<t[^>]*>([\s\S]*?)<\/t>/) || (cm[2] || "").match(/<v>([\s\S]*?)<\/v>/);
        if (t === "s" && v && ss[+v[1]] !== undefined) v[1] = ss[+v[1]];
        var tk = tokensOf(v ? unescXml(v[1]) : "");
        if (tk.indexOf("name") >= 0) hasN = true;
        if (tk.indexOf("qty") >= 0) hasQ = true;
      }
      if (hasN && hasQ) found = r;
    });
    if (found < 0) throw new Error("模板未找到产品行（需包含 {名称}{数量} 占位符）");
    return { productRow: found, widths: colWidths(sheetXml) };
  }

  (window.DocsV3 = window.DocsV3 || {}).xlsx = {
    buildXlsxXml: buildXlsxXml, detectXlsx: detectXlsx,
    parseSharedStrings: parseSharedStrings, fmtMoney: fmtMoney,
    escXml: escXml, unescXml: unescXml, ALIAS: ALIAS, tokensOf: tokensOf,
    whiteXfs: whiteXfs, whiteFontIds: whiteFontIds
  };
})();

/* docs_v3.js (part 2, v4) —— docx 签收单通用引擎（零修改）+ HTML 预览 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx;
  function escXml(s) { return X.escXml(s); }

  var R_ALIAS = {
    "发货日期": "date", "SHIP_DATE": "date",
    "联系人": "contact", "CONTACT": "contact",
    "电话": "phone", "PHONE": "phone",
    "合同": "contract", "合同编号": "contract", "CONTRACT": "contract",
    "自提": "way_self", "物流": "way_logi", "顺丰": "way_sf", "其他": "way_oth",
    "供方": "fee_sup", "收货": "fee_rec",
    "快递": "courier", "送货公司": "courier", "COURIER": "courier",
    "地址": "addr", "ADDR": "addr",
    "名称": "name", "NAME": "name", "规格": "spec", "SPEC": "spec",
    "数量": "qty", "QTY": "qty", "备注": "remark", "UNIT": "unit", "单位": "unit"
  };
  var R_TOKEN_RE = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
  var ITEM_KEYS = ["name", "spec", "qty", "remark", "unit"];

  function receiptMap(p) {
    var way = p.fields.delivery || "", fee = p.fields.freight || "";
    function mark(kw) { return way.indexOf(kw) >= 0 ? "\u2611" : "\u25A1"; }
    var fRec = fee.indexOf("收货方") >= 0;
    return {
      date: p.fields.date || (D.todayBJ ? D.todayBJ() : ""),
      contact: p.fields.contact || "", phone: p.fields.phone || "",
      contract: p.fields.contract || "",
      way_self: mark("自提"), way_logi: mark("物流"), way_sf: mark("顺丰"), way_oth: mark("其他"),
      fee_sup: fRec ? "\u25A1" : "\u2611", fee_rec: fRec ? "\u2611" : "\u25A1",
      courier: p.fields.courier || "", addr: p.fields.addr || ""
    };
  }

  function detectDocx(docXml) {
    var tbl = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
    if (!tbl) throw new Error("模板未找到表格");
    var trs = tbl[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    var protoIdx = -1;
    trs.forEach(function (t, i) {
      if (t.indexOf("{名称}") >= 0 || t.indexOf("{NAME}") >= 0) protoIdx = i;
    });
    if (protoIdx < 0) throw new Error("模板未找到产品行（表格内需有一行包含 {名称} 占位符）");
    return { tblStart: docXml.indexOf(tbl[0]), tblEnd: docXml.indexOf(tbl[0]) + tbl[0].length,
             tbl: tbl[0], trs: trs, protoIdx: protoIdx };
  }

  function cellTexts(tc) {
    var out = "", m, re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((m = re.exec(tc))) out += m[1];
    return out;
  }
  function fixWhite(rpr) {
    if (!rpr) return rpr;
    return rpr.replace(/<w:color\s+w:val="FFFFFF"\s*\/>/i, '<w:color w:val="000000"/>')
              .replace(/<w:color\s+w:val="FFFFFF"(?!\s*\/)/i, '<w:color w:val="000000"');
  }
  // 单元格填值：字面量原位替换优先（零结构修改）；多行值才重建 run（保留 tcPr/pPr/rPr）
  function docxFillCell(tc, rpr, tokenMap) {
    var names = Object.keys(tokenMap);
    var needBr = false;
    names.forEach(function (nm) { if (String(tokenMap[nm] || "").indexOf("\n") >= 0) needBr = true; });
    if (!needBr) {
      var out = tc;
      names.forEach(function (nm) {
        var lit = "{" + nm + "}";
        if (out.indexOf(lit) >= 0) out = out.split(lit).join(escXml(String(tokenMap[nm] == null ? "" : tokenMap[nm])));
      });
      return out;
    }
    // 重建：保留 tcPr + 第一段 pPr + 首个 run rPr
    var tcpr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0];
    var firstP = tc.match(/<w:p\b[\s\S]*?<\/w:p>/);
    var ppr = firstP ? ((firstP[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0]) : "";
    var full = X.unescXml(cellTexts(tc));
    names.forEach(function (nm) { full = full.split("{" + nm + "}").join(String(tokenMap[nm] == null ? "" : tokenMap[nm])); });
    var rprSafe = fixWhite(rpr);
    var runs = full.split("\n").map(function (seg, i) {
      return "<w:r>" + rprSafe + '<w:t xml:space="preserve">' + escXml(seg) + "</w:t>" + (i < full.split("\n").length - 1 ? "<w:br/>" : "");
    }).join("");
    return "<w:tc>" + tcpr + "<w:p>" + ppr + runs + "</w:p></w:tc>";
  }

  function buildDocxXml(docXml, p) {
    var det = detectDocx(docXml);
    var proto = det.trs[det.protoIdx];
    var tcs = proto.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (tcs.length < 3) throw new Error("模板产品行列数不足（应至少 名称/规格/数量）");
    // 每格 rPr（首个 run）+ 该格 token 名
    var cellInfo = tcs.map(function (tc) {
      var run = tc.match(/<w:r\b[\s\S]*?<\/w:r>/);
      var rpr = run ? ((run[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]) : "";
      var txt = cellTexts(tc);
      var toks = [], m, re = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
      while ((m = re.exec(txt))) {
        var k = R_ALIAS[m[1]];
        if (k && ITEM_KEYS.indexOf(k) >= 0) toks.push({ raw: m[1], key: k });
      }
      return { rpr: fixWhite(rpr), toks: toks };
    });
    var headerMap = receiptMap(p);
    var rows = p.items.map(function (it) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      var itemVals = {
        name: it.name || "", spec: spec, qty: String(it.qty != null ? it.qty : ""),
        remark: it.remark || (it.unit ? "单位：" + it.unit : ""), unit: it.unit || ""
      };
      var newTcs = tcs.map(function (tc, k) {
        if (!cellInfo[k].toks.length) return tc;
        var map = {};
        cellInfo[k].toks.forEach(function (t) { map[t.raw] = itemVals[t.key]; });
        return docxFillCell(tc, cellInfo[k].rpr, map);
      });
      var pos = 0;
      // 保留原始 <w:tr ...> 外层属性及 trPr，只替换四个单元格 XML
      return proto.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, function () { return newTcs[pos++]; });
    }).join("");
    var tblNew = det.tbl.replace(proto, rows);
    var xml = docXml.slice(0, det.tblStart) + tblNew + docXml.slice(det.tblEnd);
    // 表头 token 全局原位替换
    xml = xml.replace(R_TOKEN_RE, function (all, name) {
      var k = R_ALIAS[name];
      if (k && ITEM_KEYS.indexOf(k) < 0 && headerMap[k] !== undefined) return String(headerMap[k]);
      return all;
    });
    var left = [], m, cre = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((m = cre.exec(xml))) {
      var tm = m[1].match(/\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/);
      if (tm && left.indexOf(tm[0]) < 0) left.push(tm[0]);
    }
    return { xml: xml, leftTokens: left };
  }
  /* ================= HTML 预览 ================= */
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                                    .replace(/\n/g, "<br>");
  }

  function previewQuoteHtml(p, total, logoUrl) {
    var map = { customer: p.fields.customer || "", date: p.fields.date || "",
                contact: p.fields.contact || "", phone: p.fields.phone || "", email: p.fields.email || "" };
    var previewItems = p.items.slice();
    while (previewItems.length < 3) previewItems.push(null); // 原始报价单母版固定保留3个产品格
    var trs = previewItems.map(function (it, i) {
      if (!it) return '<tr class="dq-empty"><td class="c"></td><td></td><td></td><td class="spec"></td><td class="c"></td><td class="c"></td><td class="r"></td><td class="r"></td></tr>';
      var spec = it.spec || it.model || "";
      return "<tr>" +
        '<td class="c">' + (i + 1) + "</td>" +
        "<td>" + escHtml(it.name) + "</td>" +
        "<td>" + escHtml(it.model) + "</td>" +
        '<td class="spec">' + escHtml(spec) + "</td>" +
        '<td class="c">' + escHtml(it.qty) + "</td>" +
        '<td class="c">' + escHtml(it.unit) + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney(it.price) : "") + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney((it.qty || 0) * it.price) : "") + "</td>" +
        "</tr>";
    }).join("");
    return '<div class="doc-paper dq-paper">' +
      '<div class="dq-top">' +
      (logoUrl ? '<img class="dq-logo" src="' + logoUrl + '" alt="">' : '<div class="dq-logo dq-logo-ph">JIAYE TECH</div>') +
      '<div class="dq-co"><div class="dq-t1">报 价 单</div><div class="dq-t2">Quotation</div>' +
      '<div class="dq-c1">北 京 佳 业 同 创 科 技 有 限 公 司</div>' +
      '<div class="dq-c2">Beijing Jiayetongchuang Technology Co., Ltd.</div>' +
      '<div class="dq-c3">地址：北京市海淀区体院西路甲2号 14号楼1层 101</div>' +
      "</div>" +
      '<div class="dq-to"><div>致：  ' + escHtml(map.customer) + "</div><div>To:</div>" +
      '<div class="dq-date">日期 (Date):  ' + escHtml(map.date) + "</div></div>" +
      "</div>" +
      '<table class="dq-table">' +
      "<thead><tr><th class='w-no'>序号</th><th class='w-name'>产品名称</th><th class='w-model'>产品型号</th>" +
      '<th class="w-spec">配置及参数<br>Description</th><th class="w-qty">数量</th><th class="w-unit">单位</th>' +
      "<th class='w-price'>单价(元)</th><th class='w-total'>合计(元)</th></tr>" +
      "<tr><th>NO.</th><th>Commodity</th><th>SKU</th><th></th><th>Quantity</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>" +
      "<tbody>" + trs +
      '<tr class="dq-total"><td colspan="5"></td><td colspan="3" class="c tb">合计金额Total Amount</td>' +
      '<td class="r tb">' + X.fmtMoney(total) + "</td></tr>" +
      '<tr class="dq-remark"><td class="c tb">备注Remarks</td>' +
      '<td class="tb" colspan="7">' + escHtml(p.fields.remarks ? p.fields.remarks + "\n" : "") +
      "1,报价有效期：30天；<br>2,报价含13%增值税；<br>3,报价已含国内快递运费；</td></tr>" +
      "</tbody></table>" +
      '<div class="dq-contact">联系人：  ' + escHtml(map.contact) + "　　电话 tel:  " + escHtml(map.phone) +
      "　　E-mail:  " + escHtml(map.email) + "</div>" +
      "</div>";
  }

  function previewReceiptHtml(p) {
    var map = receiptMap(p);
    var trs = p.items.map(function (it) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      return "<tr>" +
        "<td>" + escHtml(it.name) + "</td>" +
        '<td class="spec">' + escHtml(spec) + "</td>" +
        '<td class="c">' + escHtml(it.qty) + "</td>" +
        "<td>" + escHtml(it.remark || (it.unit ? "单位：" + it.unit : "")) + "</td></tr>";
    }).join("");
    return '<div class="doc-paper dr-paper">' +
      '<div class="dr-title">货物签收单</div>' +
      '<div class="dr-meta">发货日期：  ' + escHtml(map.date) + "　　联系人：  " + escHtml(map.contact) +
      "　　电话：  " + escHtml(map.phone) + "　　关联合同编号：  " + escHtml(map.contract) + "</div>" +
      '<div class="dr-sub">发货清单：</div>' +
      '<table class="dr-table"><thead><tr><th class="w1">产品名称</th><th class="w2">规格及描述</th>' +
      '<th class="w3">数量</th><th class="w4">备注</th></tr></thead><tbody>' + trs + "</tbody></table>" +
      '<div class="dr-line">送货方式：' + map.way_self + "自提　" + map.way_logi + "物流　" + map.way_sf + "顺丰　" + map.way_oth + "其他" +
      "　　送货费用：" + map.fee_sup + "由供方负担　　" + map.fee_rec + "收货方自理</div>" +
      '<div class="dr-line">送货公司：  ' + escHtml(map.courier) + "</div>" +
      '<div class="dr-line dr-addr">收货方地址及联系人：  ' + escHtml(map.addr) + "</div>" +
      '<div class="dr-sign"><span class="dr-sign-bar">签　收　栏</span>' +
      '<span class="dr-signline">签收人(盖章或签字)：　　　　　　　　　　身份证号(代签需填写)：　　　　　　　　　　</span></div>' +
      '<div class="dr-declare">请阅读并理解下述声明，您在最后的签字表明您确认收到的物品与此单所填内容一致。<br>' +
      '*本货物签收单所填写的信息均与送达您手上的实际物品的信息相符合<br>' +
      '*如您对本次的送货或货物有任何意见和建议，请联系我们<br>' +
      '*请您在确认本货物签收单内容均为正确且属实后，签字或盖章确认。</div>' +
      "</div>";
  }

  (window.DocsV3 = window.DocsV3 || {}).docx = {
    buildDocxXml: buildDocxXml, detectDocx: detectDocx, receiptMap: receiptMap
  };
  (window.DocsV3 = window.DocsV3 || {}).preview = {
    previewQuoteHtml: previewQuoteHtml, previewReceiptHtml: previewReceiptHtml
  };
})();

/* docs_v3.js (part 3, v4) —— 4 子模块 UI：报价单 / 货物签收单 / PDF 导出 / 一键成表 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx, DX = window.DocsV3.docx, PV = window.DocsV3.preview;
  function $(id) { return document.getElementById(id); }

  var PREVIEW_CSS =
    ".doc-paper{background:#fff;color:#000;font-family:宋体,SimSun,serif;font-size:12px;line-height:1.6;box-sizing:border-box}" +
    ".dq-paper{padding:28px 30px;min-width:900px}" +
    ".dq-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:8px}" +
    ".dq-logo{height:64px;width:auto}" +
    ".dq-logo-ph{font-size:14px;color:#356;font-weight:700;padding-top:20px}" +
    ".dq-co{flex:1}" +
    ".dq-t1{text-align:center;font-size:26px;font-weight:700;letter-spacing:12px}" +
    ".dq-t2{text-align:center;font-size:16px;margin:2px 0 8px}" +
    ".dq-c1{font-size:14px;font-weight:700;letter-spacing:2px}" +
    ".dq-c2,.dq-c3{font-size:11px}" +
    ".dq-to{width:340px;text-align:right;font-size:13px}" +
    ".dq-date{margin-top:14px}" +
    ".dq-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dq-table th,.dq-table td{border:1px solid #000;padding:4px 6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dq-table thead th{font-weight:700;text-align:center}" +
    ".dq-table .c{text-align:center}.dq-table .r{text-align:right}" +
    ".dq-table .spec{text-align:left;font-size:11px}" +
    ".dq-table .w-no{width:44px}.dq-table .w-name{width:110px}.dq-table .w-model{width:90px}" +
    ".dq-table .w-qty{width:64px}.dq-table .w-unit{width:48px}.dq-table .w-price{width:90px}.dq-table .w-total{width:96px}" +
    ".dq-table .tb{font-weight:700}" +
    ".dq-table tbody tr:not(.dq-total):not(.dq-remark) td{height:40px}" +
    ".dq-total td{height:30px}" +
    ".dq-remark td{height:74px;vertical-align:top;font-size:11px}" +
    ".dq-contact{margin-top:10px;text-align:right;font-size:12px}" +
    ".dr-paper{padding:34px 44px;max-width:760px}" +
    ".dr-title{text-align:center;font-size:22px;font-weight:700;letter-spacing:8px;margin-bottom:18px}" +
    ".dr-meta{font-size:12px;margin-bottom:22px}" +
    ".dr-sub{text-align:center;margin-bottom:8px}" +
    ".dr-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dr-table th,.dr-table td{border:1px solid #000;padding:6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dr-table thead th{text-align:center;font-weight:700}" +
    ".dr-table .c{text-align:center}.dr-table .spec{font-size:11px}" +
    ".dr-table .w1{width:24%}.dr-table .w2{width:46%}.dr-table .w3{width:12%}.dr-table .w4{width:18%}" +
    ".dr-line{font-size:12px;margin-top:10px}" +
    ".dr-addr{line-height:1.8}" +
    ".dr-sign{margin-top:26px;border-top:1px dashed #000;padding-top:0;font-size:13px}" +
    ".dr-sign-bar{display:inline-block;background:#000;color:#fff;padding:4px 24px;font-weight:700;letter-spacing:6px;transform:translateY(-50%)}" +
    ".dr-signline{display:block;font-weight:400;letter-spacing:0;margin:18px 0 48px;font-size:12px;line-height:5}" +
    ".dr-declare{border-top:1px solid #000;padding-top:10px;font-size:11px;line-height:2}" +
    ".dt-paper{padding:34px 40px;max-width:860px}" +
    ".dt-title{text-align:center;font-size:20px;font-weight:700;letter-spacing:6px;margin-bottom:16px}" +
    ".dt-meta{font-size:12px;margin-bottom:12px}" +
    ".dt-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dt-table th,.dt-table td{border:1px solid #000;padding:6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dt-table thead th{text-align:center;font-weight:700;background:#f2f2f2}" +
    ".dt-table .c{text-align:center}.dt-table .r{text-align:right}.dt-table .spec{font-size:11px}" +
    ".dt-table .w1{width:20%}.dt-table .w2{width:13%}.dt-table .w3{width:37%}.dt-table .w4{width:9%}.dt-table .w5{width:7%}.dt-table .w6{width:9%}.dt-table .w7{width:15%}" +
    ".dt-total td{font-weight:700}";

  var PRINT_CSS = "@page{margin:10mm}html,body{margin:0;padding:0}.dr-paper,.dt-paper{max-width:none;width:auto}" + PREVIEW_CSS;

  function printPdf(bodyHtml, landscape, title) {
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>" + (title || "打印") +
      "</title><style>" + PRINT_CSS + "</style></head><body>" + bodyHtml + "</body></html>";
    var ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:100%;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(ifr);
    var d = ifr.contentWindow.document;
    d.open(); d.write(html); d.close();
    setTimeout(function () {
      try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) { }
      setTimeout(function () { if (ifr.parentNode) ifr.parentNode.removeChild(ifr); }, 120000);
    }, 400);
  }

  // 通用表格预览（一键成表 / 无模板 PDF 兜底）
  function previewTableHtml(p) {
    var trs = p.items.map(function (it, i) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      return "<tr>" +
        '<td class="c">' + (i + 1) + "</td>" +
        "<td>" + escH(it.name) + "</td>" +
        '<td class="spec">' + escH(spec) + "</td>" +
        '<td class="c">' + escH(it.qty) + "</td>" +
        '<td class="c">' + escH(it.unit) + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney(it.price) : "") + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney((it.qty || 0) * it.price) : "") + "</td></tr>";
    }).join("");
    var total = 0;
    p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
    return '<div class="doc-paper dt-paper"><div class="dt-title">产品清单</div>' +
      '<div class="dt-meta">日期：' + escH(p.fields.date || "") + (p.fields.customer ? "　客户：" + escH(p.fields.customer) : "") + "</div>" +
      '<table class="dt-table"><thead><tr><th class="w1">序号</th><th class="w2">产品名称</th><th class="w3">配置及参数</th>' +
      "<th class='w4'>数量</th><th class='w5'>单位</th><th class='w6'>单价(元)</th><th class='w7'>合计(元)</th></tr></thead><tbody>" + trs +
      '<tr class="dt-total"><td colspan="6" class="r">合计金额</td><td class="r">' + X.fmtMoney(total) + "</td></tr></tbody></table></div>";
  }
  function escH(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }

  /* ---------- 状态 ---------- */
  var state = {
    kind: "quote",
    custom: { xlsx: null, docx: null },
    customName: { xlsx: "", docx: "" },
    last: null,
    tplCache: {}, logoUrl: ""
  };
  function msg(t, err) {
    var el = $("docs-msg");
    if (el) { el.textContent = t || ""; el.style.color = err ? "#c0392b" : ""; }
  }
  function assetVer() {
    var s = document.querySelector('script[src*="docs_v3.js"]');
    var m = s && s.src.match(/[?&]v=([\w]+)/);
    return m ? m[1] : String(Date.now());
  }
  function loadTplBuf(file, force) {
    // 仅「一键成表」内置模板支持自定义模板替换
    var customKey = file === "generic_table.xlsx" ? "xlsx" : (file === "generic_table.docx" ? "docx" : null);
    if (customKey && !force && state.custom[customKey]) return Promise.resolve(state.custom[customKey]);
    var url = "/templates/" + file + "?v=" + assetVer() + (force ? "&t=" + Date.now() : "");
    if (!force && state.tplCache[url]) return state.tplCache[url];
    var pr = fetch(url, force ? { cache: "no-store" } : undefined).then(function (r) {
      if (!r.ok) throw new Error("模板加载失败：" + url);
      return r.arrayBuffer();
    });
    if (!force) state.tplCache[url] = pr;
    return pr;
  }
  function logoDataUrl() {
    if (state.logoUrl) return Promise.resolve(state.logoUrl);
    return loadTplBuf("quote_template.xlsx").then(function (buf) {
      return JSZip.loadAsync(buf).then(function (zip) {
        var f = zip.file("xl/media/image1.png");
        if (!f) { state.logoUrl = ""; return ""; }
        return f.async("base64").then(function (b64) { state.logoUrl = "data:image/png;base64," + b64; return state.logoUrl; });
      });
    }).catch(function () { state.logoUrl = ""; return ""; });
  }
  function download(buf, name) {
    var blob = new Blob([buf], { type: "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /* ---------- 读取 zip 三段 ---------- */
  function readParts(zip, xlsx) {
    if (xlsx) {
      var sx = zip.file("xl/worksheets/sheet1.xml");
      if (!sx) throw new Error("模板缺少工作表");
      return Promise.all([
        sx.async("string"),
        zip.file("xl/sharedStrings.xml") ? zip.file("xl/sharedStrings.xml").async("string") : Promise.resolve(null),
        zip.file("xl/styles.xml") ? zip.file("xl/styles.xml").async("string") : Promise.resolve("")
      ]).then(function (a) { return { sheet: a[0], ss: a[1], styles: a[2] }; });
    }
    var dx = zip.file("word/document.xml");
    if (!dx) throw new Error("模板缺少文档");
    return dx.async("string").then(function (x) { return { doc: x }; });
  }

  /* ---------- 生成 ---------- */
  async function buildQuote(p, force) {
    var zip = await JSZip.loadAsync(await loadTplBuf("quote_template.xlsx", force));
    var a = await readParts(zip, true);
    var res = X.buildXlsxXml(a.sheet, a.ss, a.styles, p, "quote");
    zip.file("xl/worksheets/sheet1.xml", res.sheetXml);
    if (res.ssXml && a.ss) zip.file("xl/sharedStrings.xml", res.ssXml);
    if (res.stylesXml && a.styles) zip.file("xl/styles.xml", res.stylesXml);
    return zip.generateAsync({ type: "arraybuffer" });
  }
  async function buildReceipt(p, force) {
    var zip = await JSZip.loadAsync(await loadTplBuf("receipt_template.docx", force));
    var a = await readParts(zip, false);
    var res = DX.buildDocxXml(a.doc, p);
    if (res.leftTokens.length) msg("提示：模板残留未识别占位符 " + res.leftTokens.join(" "));
    zip.file("word/document.xml", res.xml);
    return zip.generateAsync({ type: "arraybuffer" });
  }
  async function buildTable(p, type, force) {
    // type: xlsx | docx
    var file = type === "xlsx" ? "generic_table.xlsx" : "generic_table.docx";
    var zip = await JSZip.loadAsync(await loadTplBuf(file, force));
    var a = await readParts(zip, type === "xlsx");
    if (type === "xlsx") {
      var res = X.buildXlsxXml(a.sheet, a.ss, a.styles, p, "quote");
      zip.file("xl/worksheets/sheet1.xml", res.sheetXml);
      if (res.ssXml && a.ss) zip.file("xl/sharedStrings.xml", res.ssXml);
      if (res.stylesXml && a.styles) zip.file("xl/styles.xml", res.stylesXml);
    } else {
      var res2 = DX.buildDocxXml(a.doc, p);
      zip.file("word/document.xml", res2.xml);
    }
    return zip.generateAsync({ type: "arraybuffer" });
  }

  function detectKind(p) {
    if (p.fields.delivery || p.fields.freight || p.fields.courier || p.fields.addr) return "receipt";
    return "quote";
  }
  function previewOf(kind, p) {
    if (kind === "quote") {
      var total = 0;
      p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
      return { html: PV.previewQuoteHtml(p, total, state.logoUrl || ""), landscape: true };
    }
    if (kind === "receipt") return { html: PV.previewReceiptHtml(p), landscape: false };
    return { html: previewTableHtml(p), landscape: false };
  }

  function parseInput() {
    var text = ($("docs-input") || { value: "" }).value.trim();
    if (!text) { msg("请先粘贴信息（或点「图片识别」）", true); return null; }
    var p = D.parseFree(text);
    if (!p.items.length) { msg("未识别到产品行。每行一件产品即可，无需符号，例如：联想开天X5h G1d-A007 LK-X5h 海光C86-4G/16G内存 10台 8300", true); return null; }
    return p;
  }

  // 报价单 / 签收单：生成预览
  async function doPreview() {
    msg("");
    var pv = $("docs-preview");
    if (pv) pv.innerHTML = "";
    var p = parseInput();
    if (!p) return;
    var kind = state.kind; // quote | receipt
    var attempt = 0;
    for (;;) {
      try {
        var buf = kind === "quote" ? await buildQuote(p, attempt > 0) : await buildReceipt(p, attempt > 0);
        var pr = previewOf(kind, p);
        var name = kind === "quote"
          ? "报价单_" + (p.fields.customer || "客户") + "_" + (p.fields.date || "") + ".xlsx"
          : "签收单_" + (p.fields.contract || p.fields.customer || "客户") + ".docx";
        state.last = { buf: buf, name: name, html: pr.html, landscape: pr.landscape, kind: kind };
        if (pv) { pv.innerHTML = pr.html; pv.classList.remove("hide"); }
        var act = $("docs-actions");
        if (act) act.classList.remove("hide");
        showMainAction();
        msg("预览已生成，核对后下载");
        break;
      } catch (e) {
        if (attempt === 0 && /模板/.test(e.message) && /产品行|占位符|表格/.test(e.message)) { attempt = 1; continue; }
        msg("生成失败：" + e.message, true);
        break;
      }
    }
  }
  // PDF 导出模块：一键
  async function doPdf() {
    msg("");
    var p = parseInput();
    if (!p) return;
    var kind = detectKind(p);
    var pr = previewOf(kind, p);
    var title = (kind === "receipt" ? "签收单" : "报价单") + "_" + (p.fields.customer || "客户") + "_" + (p.fields.date || "") + ".pdf";
    state.last = { html: pr.html, landscape: pr.landscape, kind: kind };
    printPdf(pr.html, pr.landscape, title);
    msg("已打开打印对话框（" + (kind === "receipt" ? "识别为签收单" : "识别为报价单") + "）：目标打印机选「另存为 PDF」即可");
  }
  // 一键成表：三个通道
  async function doTable(type) { // xlsx | docx | pdf
    msg("");
    var p = parseInput();
    if (!p) return;
    var attempt = 0;
    for (;;) {
      try {
        if (type === "pdf") {
          printPdf(previewTableHtml(p), false, "表格_" + (p.fields.customer || "") + ".pdf");
          msg("已打开打印对话框：目标打印机选「另存为 PDF」");
        } else {
          var buf = await buildTable(p, type, attempt > 0);
          var name = "表格_" + (p.fields.customer || p.fields.date || "") + (type === "xlsx" ? ".xlsx" : ".docx");
          download(buf, name);
          msg("已生成并下载 " + name + (state.custom[type] ? "（使用您上传的模板）" : ""));
        }
        break;
      } catch (e) {
        if (attempt === 0 && /模板/.test(e.message) && /产品行|占位符|表格/.test(e.message)) { attempt = 1; continue; }
        msg("生成失败：" + e.message, true);
        break;
      }
    }
  }

  /* ---------- 自定义模板（仅一键成表模块） ---------- */
  async function loadCustomTpl(file) {
    var isX = /\.xlsx?$/i.test(file.name);
    var type = isX ? "xlsx" : "docx";
    try {
      var buf = await file.arrayBuffer();
      var zip = await JSZip.loadAsync(buf);
      if (type === "xlsx") {
        var a = await readParts(zip, true);
        X.detectXlsx(a.sheet, X.parseSharedStrings(a.ss));
      } else {
        var a2 = await readParts(zip, false);
        DX.detectDocx(a2.doc);
      }
      state.custom[type] = buf;
      state.customName[type] = file.name;
      tplChip();
      msg("模板已启用（" + (type === "xlsx" ? "Excel" : "Word") + "）：" + file.name);
    } catch (e) {
      msg("模板无效：" + e.message + "（产品行需包含 {名称}{数量} 占位符）", true);
    }
  }
  function resetTpl() {
    state.custom.xlsx = null; state.custom.docx = null;
    state.customName.xlsx = ""; state.customName.docx = "";
    tplChip();
    msg("已恢复内置空白模板");
  }
  function tplChip() {
    var chip = $("docs-tpl-chip");
    if (!chip) return;
    var ex = state.custom.xlsx ? "Excel·" + state.customName.xlsx : "Excel·内置";
    var wd = state.custom.docx ? "Word·" + state.customName.docx : "Word·内置";
    chip.textContent = "当前模板：" + ex + " / " + wd;
  }
  async function dlBlank(type) {
    var buf = await loadTplBuf(type === "xlsx" ? "generic_table.xlsx" : "generic_table.docx");
    download(buf, type === "xlsx" ? "空白表格模板.xlsx" : "空白表格模板.docx");
  }

  /* ---------- 标签切换 ---------- */
  var HINTS = {
    quote: "整块粘贴即可（客户信息 + 产品行混排，产品行无需符号，如：联想开天X5h LK-X5h 海光C86/16G 10台 8300），也可点「图片识别」拍照提取。生成预览核对后下载 Excel。",
    receipt: "整块粘贴即可（发货日期/联系人/合同编号/送货方式/收货地址 + 产品行，产品行无需符号）。生成预览核对后下载 Word。",
    pdf: "整块粘贴信息，自动识别是报价单还是签收单，一键打印导出 PDF（打印对话框里选「另存为 PDF」）。",
    table: "快速制表工具：整块粘贴信息，一键生成 Word / Excel / PDF 表格。支持上传自己的模板：先「下载空白模板」改好版式再上传（产品行需含 {名称}{数量} 占位符）。"
  };
  function setTab(kind) {
    state.kind = kind;
    state.last = null;
    var pv = $("docs-preview"); if (pv) { pv.innerHTML = ""; pv.classList.add("hide"); }
    var act = $("docs-actions"); if (act) act.classList.add("hide");
    var tb = $("docs-tplbar"); if (tb) tb.classList.toggle("hide", kind !== "table");
    var hint = $("docs-hint"); if (hint) hint.textContent = HINTS[kind];
    var gen = $("docs-gen");
    if (gen) gen.textContent = kind === "pdf" ? "🖨 一键导出 PDF" : (kind === "table" ? "👀 预览内容" : "👀 生成预览");
    if (kind === "table") tplChip();
    msg("");
  }

  /* ---------- 导出按钮 ---------- */
  function setActionBtn(id, label, visible, fn) {
    var b = $(id);
    if (!b) return;
    b.textContent = label || "";
    b.classList.toggle("hide", !visible);
    b.onclick = fn || null;
  }
  function showTableActions() {
    setActionBtn("docs-dl-1", "⬇ 一键 Word", true, function () { doTable("docx"); });
    setActionBtn("docs-dl-2", "⬇ 一键 Excel", true, function () { doTable("xlsx"); });
    setActionBtn("docs-dl-3", "🖨 一键 PDF", true, function () { doTable("pdf"); });
  }
  function showMainAction() {
    var kind = state.kind;
    if (kind === "quote" || kind === "receipt") {
      setActionBtn("docs-dl-1", kind === "quote" ? "⬇ 下载 Excel" : "⬇ 下载 Word", true, dlNative);
      setActionBtn("docs-dl-2", "", false, null);
      setActionBtn("docs-dl-3", "", false, null);
    }
  }
  function dlNative() {
    if (!state.last || !state.last.buf) return msg("请先生成预览", true);
    download(state.last.buf, state.last.name);
  }

  /* ---------- 装配 ---------- */
  function init() {
    if (!document.getElementById("docs-v3-css")) {
      var st = document.createElement("style");
      st.id = "docs-v3-css";
      st.textContent = PREVIEW_CSS +
        "#docs-preview{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:auto;background:#e8eaed;padding:18px;max-height:70vh}" +
        "#docs-preview .doc-paper{margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
        "#docs-actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}" +
        "#docs-actions .btn{padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px}" +
        "#docs-actions .btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}" +
        "#docs-actions .btn.primary:hover{background:var(--brand2);border-color:var(--brand2);color:#fff}" +
        "#docs-actions .btn:hover{border-color:#0f7b5f;color:#0f7b5f}" +
        ".docs-tplbar{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px}" +
        ".docs-tplbar button{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px}" +
        ".docs-tplbar button:hover{border-color:#0f7b5f;color:#0f7b5f}";
      document.head.appendChild(st);
    }
    document.querySelectorAll(".docs-tab").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.doc || "quote"); });
    });
    var gen = $("docs-gen");
    if (gen) gen.addEventListener("click", function () {
      if (state.kind === "pdf") doPdf();
      else if (state.kind === "table") {
        var p = parseInput();
        if (!p) return;
        msg("");
        var pv = $("docs-preview");
        if (pv) { pv.innerHTML = previewTableHtml(p); pv.classList.remove("hide"); }
        var act = $("docs-actions"); if (act) act.classList.remove("hide");
        showTableActions();
        msg("预览如下，用下方按钮一键导出");
      }
      else doPreview();
    });
    var up = $("docs-tpl-upload"); if (up) up.addEventListener("click", function () { var f = $("docs-tpl-file"); if (f) f.click(); });
    var fi = $("docs-tpl-file"); if (fi) fi.addEventListener("change", function () { if (fi.files && fi.files[0]) loadCustomTpl(fi.files[0]); fi.value = ""; });
    var rs = $("docs-tpl-reset"); if (rs) rs.addEventListener("click", resetTpl);
    var bkx = $("docs-tpl-blank-x"); if (bkx) bkx.addEventListener("click", function () { dlBlank("xlsx"); });
    var bkd = $("docs-tpl-blank-d"); if (bkd) bkd.addEventListener("click", function () { dlBlank("docx"); });
    setTab(state.kind);
  }
  if (typeof document !== "undefined" && document.getElementById("docsbox")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  var api = {
    buildXlsxXml: X.buildXlsxXml, detectXlsx: X.detectXlsx,
    parseSharedStrings: X.parseSharedStrings,
    whiteXfs: X.whiteXfs, whiteFontIds: X.whiteFontIds,
    buildDocxXml: DX.buildDocxXml, detectDocx: DX.detectDocx,
    previewQuoteHtml: PV.previewQuoteHtml, previewReceiptHtml: PV.previewReceiptHtml,
    previewTableHtml: previewTableHtml, printPdf: printPdf, fmtMoney: X.fmtMoney
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

