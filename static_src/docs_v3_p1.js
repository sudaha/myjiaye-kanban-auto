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
    var uniformVariants = {};
    var uniformFontIdx = -1;
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
    // 动态填入的数据格统一正文：宋体 10、常规、黑色、水平/垂直居中。
    // 仅克隆对应 xf 并替换 fontId/alignment；边框/填充/数字格式保持原样。
    function uniformVariant(xfIdx) {
      if (!stylesXml || uniformVariants[xfIdx] !== undefined) return uniformVariants[xfIdx] !== undefined ? uniformVariants[xfIdx] : xfIdx;
      if (uniformFontIdx < 0) {
        var fsec = stylesOut.match(/<fonts count="(\d+)">[\s\S]*?<\/fonts>/);
        if (!fsec) return xfIdx;
        uniformFontIdx = +fsec[1];
        var font = '<font><name val="宋体"/><sz val="10"/><color rgb="FF000000"/><family val="3"/><charset val="134"/><scheme val="minor"/></font>';
        var fnew = fsec[0].replace(/<\/fonts>/, font + "</fonts>").replace(/<fonts count="\d+"/, '<fonts count="' + (uniformFontIdx + 1) + '"');
        stylesOut = stylesOut.replace(fsec[0], fnew);
      }
      var xfSec = stylesOut.match(/<cellXfs count="(\d+)">[\s\S]*?<\/cellXfs>/);
      if (!xfSec) return xfIdx;
      var xfs = xfSec[0].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
      var xfStr = xfs[xfIdx] || "";
      if (!xfStr) return xfIdx;
      var newXf = /\bfontId="\d+"/.test(xfStr) ? xfStr.replace(/\bfontId="\d+"/, 'fontId="' + uniformFontIdx + '"') : xfStr.replace(/<xf\b/, '<xf fontId="' + uniformFontIdx + '"');
      newXf = newXf.replace(/^<xf\b[^>]*>/, function (tag) {
        if (/\bapplyFont=/.test(tag)) tag = tag.replace(/\bapplyFont="[^"]*"/, 'applyFont="1"');
        else tag = tag.replace(/\s*\/?\>$/, function (end) { return ' applyFont="1"' + (end.indexOf('/') >= 0 ? '/>' : '>'); });
        if (/\bapplyAlignment=/.test(tag)) tag = tag.replace(/\bapplyAlignment="[^"]*"/, 'applyAlignment="1"');
        else tag = tag.replace(/\s*\/?\>$/, function (end) { return ' applyAlignment="1"' + (end.indexOf('/') >= 0 ? '/>' : '>'); });
        return tag;
      });
      var align = '<alignment horizontal="center" vertical="center" wrapText="1"/>';
      if (/\/\>$/.test(newXf)) newXf = newXf.replace(/\/>$/, ' applyAlignment="1">' + align + '</xf>');
      else if (/<alignment\b[^>]*\/>/.test(newXf)) newXf = newXf.replace(/<alignment\b[^>]*\/>/, align);
      else if (/<\/xf>$/.test(newXf)) newXf = newXf.replace(/<\/xf>$/, align + '</xf>');
      var newIdx = +xfSec[1];
      var xfNew = xfSec[0].replace(/<\/cellXfs>/, newXf + "</cellXfs>").replace(/<cellXfs count="\d+"/, '<cellXfs count="' + (newIdx + 1) + '"');
      stylesOut = stylesOut.replace(xfSec[0], xfNew);
      uniformVariants[xfIdx] = newIdx;
      return newIdx;
    }

    // 白字单元格 → 克隆 font/xf 改黑（兼容旧自定义模板）
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
    function fillRowTokens(rowXml, cells, map, uniformData) {
      var out = rowXml;
      cells.forEach(function (c) {
        if (!c.ref || !tokensOf(c.text).length) return;
        var newVal = replaceTokens(c.text, map);
        var sAttr = c.s;
        if (uniformData) sAttr = String(uniformVariant(+c.s));
        else if (wXfs[c.s]) sAttr = String(blackVariant(+c.s));
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
      clone = fillRowTokens(clone, cList, i < n ? rowVals[i] : emptyVals, true);
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
