load("sbbsdefs.js");
load("frame.js");

const test_sub = "LOCAL-TEST_ADS".toLowerCase();

var SUB_CODE = test_sub || "fsx_dat";
var SUBJ = "InterBBS Oneliner";
var RECIPIENT = "IBBS1LINE";
var MAX_LEN = 80;
var ENTRY_MAX_LEN = 65;
var MAX_PENDING_ONELINERS = 10;
var MAX_FETCH_ITEMS = 200;
var BANNER_FILE = "interbbs_one_liners.bin";
var DEBUG_HEADERS = true;
var pendingGroupId = null;
var TABLE_THEME = {
    frame: {
        parent: BG_BLACK | LIGHTGRAY,
        header: BG_BLUE | WHITE,
        list: BG_BLACK | LIGHTGRAY,
        footer: BG_BLACK | LIGHTGRAY
    },
    headerRow: WHITE | BG_BLUE,
    rowAttrs: [LIGHTGRAY | BG_BLACK, LIGHTCYAN | BG_BLACK],
    highlight: BLACK | BG_LIGHTGRAY,
    footerText: LIGHTGRAY | BG_BLACK,
    border: CYAN | BG_BLACK
};
var ENTRY_FROM_ATTR = LIGHTGRAY | BG_BLACK;
var ENTRY_TEXT_ATTR = WHITE | BG_BLACK;
var ENTRY_LINES = 1; // deprecated (kept for compatibility)
function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

function gotoxySafe(f, x, y) {
    if (!f) return;
    x = clamp(x | 0, 1, f.width);
    y = clamp(y | 0, 1, f.height);
    f.gotoxy(x, y);
}

function centerLeftX(f, blockWidth) {
    var w = clamp(blockWidth | 0, 1, f.width);
    // Center within the *frame*, 1-based
    return 1 + Math.floor((f.width - w) / 2);
}
(function main() {
    console.clear();
    console.autowrap = false;

    var parentFrame = new Frame(1, 1, console.screen_columns, console.screen_rows, TABLE_THEME.frame.parent);
    var headerHeight = Math.min(6, Math.max(1, parentFrame.height - 2));
    var footerHeight = 2;
    if (headerHeight + footerHeight >= parentFrame.height)
        headerHeight = Math.max(1, parentFrame.height - footerHeight - 1);
    var header = new Frame(1, 1, parentFrame.width, headerHeight, TABLE_THEME.frame.header, parentFrame);
    var footer = new Frame(1, parentFrame.height - footerHeight + 1, parentFrame.width, footerHeight, TABLE_THEME.frame.footer, parentFrame);
    var listHeight = Math.max(1, parentFrame.height - header.height - footer.height);
    var list = new Frame(1, header.height + 1, parentFrame.width, listHeight, TABLE_THEME.frame.list, parentFrame);

    var bannerWidth = Math.min(80, header.width);
    var bannerX = centerLeftX(header, bannerWidth);   // always 1..header.width
    var banner = new Frame(bannerX, 1, bannerWidth, header.height, WHITE | BG_GREEN, header);

    parentFrame.open();
    header.draw();
    banner.open();
    loadBannerArt(banner);
    banner.draw();
    banner.top();
    footer.erase();
    footer.draw();

    var entries = fetchOneliners(MAX_FETCH_ITEMS);
    var pending = [];
    pendingGroupId = null;
    var view = makeView(buildViewRows(entries, pending), entriesPerPage(list));

    paintEntries(list, view);
    parentFrame.draw();
    setFooterMessage(footer, pending);
    flushConsoleKeys();

    function refreshViewAndDraw(forceTop) {
        view = makeView(buildViewRows(entries, pending), entriesPerPage(list), view);
        if (forceTop && view) view.top = 0;
        var pageSize = entriesPerPage(list);
        var maxTop = Math.max(0, (view.rows.length || 0) - pageSize);
        if (view.top < 0) view.top = 0;
        if (view.top > maxTop) view.top = maxTop;
        paintEntries(list, view);
        parentFrame.draw();
    }

    function addPendingLine(text) {
        if (!pendingGroupId) pendingGroupId = makePendingGroupId();
        var entry = buildPendingEntry(text, pendingGroupId);
        pending.push(entry);
        refreshViewAndDraw(true);
    }

    function initialPromptText() {
        return "<\1h\1w>Enter oneliner <\1c>(<\1h\1c>max 65 chars - blank cancels<\1n\1c>)<\1h\1w>:";
    }

    function followUpPrompt(lineIndex) {
        var submittedCount = pending.length === 1 ? "1 line" : (pending.length + " lines");
        return "<\1h\1w>Write another?<\1n> <\1c>(<\1h\1c>#" + lineIndex + " of " + MAX_PENDING_ONELINERS +
            " - blank submits " + submittedCount + "<\1n\1c>)<\1h\1w>:";
    }

    function promptForLine(promptText) {
        var input = promptFooterInput(footer, promptText);
        var raw = trim(stripCtrl(input));
        if (raw.length > ENTRY_MAX_LEN) {
            raw = raw.substr(0, ENTRY_MAX_LEN);
            setFooterMessage(footer, pending, "Trimmed to " + ENTRY_MAX_LEN + " chars.");
        }
        return raw;
    }

    function submitPendingAndExit() {
        if (!pending.length) return false;
        var count = pending.length;
        setFooterMessage(footer, pending, "Posting " + count + " line(s)...");
        var ok = saveOnelinerBatch(pending);
        if (ok) {
            pending.length = 0;
            pendingGroupId = null;
            setFooterMessage(footer, pending, "Oneliners submitted.");
            parentFrame.close();
            console.clear();
            console.crlf();
            console.putmsg("\1n\1wPosted " + count + " oneliner" + (count === 1 ? "" : "s") + ". Press any key to exit.\r\n");
            console.getkey();
            return true;
        }
        setFooterMessage(footer, pending, "Post failed. Try again.");
        return false;
    }

    function beginPostFlow() {
        pending.length = 0;
        pendingGroupId = null;
        refreshViewAndDraw(false);
        var firstLine = promptForLine(initialPromptText());
        if (!firstLine.length) {
            setFooterMessage(footer, pending, "Posting canceled.");
            return false;
        }
        addPendingLine(firstLine);
        while (pending.length < MAX_PENDING_ONELINERS) {
            var nextIndex = pending.length + 1;
            if (nextIndex > MAX_PENDING_ONELINERS) break;
            var nextLine = promptForLine(followUpPrompt(nextIndex));
            if (!nextLine.length) break;
            addPendingLine(nextLine);
        }
        if (submitPendingAndExit()) return true;
        return false;
    }

    var running = true;
    while (running && !js.terminated) {
        if (parentFrame.cycle()) console.gotoxy(console.cx, console.cy);
        var k = console.inkey(K_NONE, 200);
        if (!k) continue;

        var lower = String(k).toLowerCase();
        if (k === "\r" || k === "\n") lower = "q";
        var repaint = false;
        var pageSize = entriesPerPage(list);
        var maxTop = Math.max(0, (view.rows.length || 0) - pageSize);

        switch (k) {
            case KEY_UP:
                if (view.top > 0) { view.top--; repaint = true; }
                break;
            case KEY_DOWN:
                if (view.top < maxTop) { view.top++; repaint = true; }
                break;
            case KEY_PAGEUP:
                if (view.top > 0) {
                    view.top = Math.max(0, view.top - pageSize);
                    repaint = true;
                }
                break;
            case KEY_PAGEDN:
                if (view.top < maxTop) {
                    view.top = Math.min(maxTop, view.top + pageSize);
                    repaint = true;
                }
                break;
            case KEY_HOME:
                if (view.top !== 0) { view.top = 0; repaint = true; }
                break;
            case KEY_END:
                if (view.top !== maxTop) { view.top = maxTop; repaint = true; }
                break;
            default:
                if (lower === "p") {
                    if (beginPostFlow()) {
                        running = false;
                        break;
                    }
                } else if (lower === "q" || k === "\x1b") {
                    if (!pending.length) {
                        running = false;
                        break;
                    }
                    setFooterMessage(footer, pending, "Posting queued oneliners...");
                    if (saveOnelinerBatch(pending)) {
                        pending.length = 0;
                        pendingGroupId = null;
                        entries = fetchOneliners(MAX_FETCH_ITEMS);
                        view = makeView(buildViewRows(entries, pending), entriesPerPage(list));
                        setFooterMessage(footer, pending, "Oneliners submitted.");
                        repaint = true;
                        running = false;
                    } else {
                        setFooterMessage(footer, pending, "Post failed. Try again.");
                    }
                }
                break;
        }

        if (repaint) {
            paintEntries(list, view);
            parentFrame.draw();
        }
    }

    parentFrame.close();
})();

function flushConsoleKeys() {
    if (typeof console === "undefined" || !console) return;
    var key;
    do {
        key = console.inkey(K_NOECHO | K_NOSPIN, 0);
    } while (key);
}

function fetchOneliners(limit) {
    var items = [];
    var mb = new MsgBase(SUB_CODE);
    if (!mb.open()) {
        return [{ text: "Unable to open sub " + SUB_CODE, from: "System", when: 0 }];
    }

    var total = mb.total_msgs | 0;
    for (var idx = total - 1; idx >= 0 && items.length < limit; idx--) {
        var hdr = mb.get_msg_header(true, idx);
        if (!hdr)
            continue;
        var body = mb.get_msg_body(true, idx);
        if (!body)
            continue;
        var lines = parseOnelinerLines(body, hdr);
        var groupId = makeHeaderGroupId(hdr);
        for (var i = 0; i < lines.length && items.length < limit; i++) {
            lines[i].groupId = groupId;
            items.push(lines[i]);
        }
    }

    mb.close();
    return items.reverse();
}

function buildViewRows(entries, pending) {
    var pendingGroups = pending && pending.length ? groupEntries(pending, true) : [];
    var historyGroups = groupEntries(entries || []);
    var allGroups = pendingGroups.concat(historyGroups);
    var rows = [];
    for (var g = 0; g < allGroups.length; g++) {
        var grp = allGroups[g];
        rows.push({ kind: "header", groupId: grp.id, header: grp.header });
        var lines = grp.isPending ? grp.lines : grp.lines.slice().reverse();
        for (var ln = 0; ln < lines.length; ln++) {
            rows.push({ kind: "text", groupId: grp.id, text: lines[ln].text || "", header: grp.header });
        }
    }
    return rows;
}

function groupEntries(entries, isPending) {
    var groups = Object.create(null);
    var order = [];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var gid = entry.groupId || ((isPending ? "pending-auto" : "hist-auto") + "-" + i);
        var grp = groups[gid];
        if (!grp) {
            grp = {
                id: gid,
                header: entry,
                lines: [],
                when: entry.when || 0,
                seq: order.length,
                isPending: !!isPending
            };
            groups[gid] = grp;
            order.push(grp);
        }
        grp.lines.push(entry);
    }
    order.sort(function (a, b) {
        if (isPending) return a.seq - b.seq; // newest pending should stay on top in entry order
        if (b.when !== a.when) return b.when - a.when;
        return b.seq - a.seq;
    });
    return order;
}

function makeView(rows, perPage, prev) {
    rows = rows || [];
    var page = perPage || rows.length || 1;
    var top = prev && typeof prev.top === "number" ? prev.top : 0;
    var maxTop = Math.max(0, rows.length - page);
    if (top < 0) top = 0;
    if (top > maxTop) top = maxTop;
    return {
        rows: rows,
        top: top
    };
}

function paintEntries(frame, view) {
    frame.clear();
    var rows = view.rows || [];
    var perPage = entriesPerPage(frame);
    var maxTop = Math.max(0, rows.length - perPage);
    if (view.top === undefined || view.top < 0) view.top = 0;
    if (view.top > maxTop) view.top = maxTop;
    var width = Math.min(80, Math.max(1, frame.width - 2));
    var y = 1;
    if (!rows.length) {
        putCentered(frame, y, clipLine(" (no oneliners available)", width), ENTRY_FROM_ATTR);
        frame.draw();
        return;
    }
    for (var i = view.top; i < rows.length && y <= frame.height; i++) {
        var row = rows[i];
        if (row.kind === "header") {
            var headerLine = clipLine(formatFromLine(row.header || row), width);
            putAligned(frame, y, headerLine, ENTRY_FROM_ATTR);
        } else {
            var textLine = clipLine(row.text || "", width);
            putRightAligned(frame, y, textLine, ENTRY_TEXT_ATTR, width);
        }
        y++;
    }
    frame.draw();
}

function buildDisplayList(entries, pending, maxItems) {
    var limit = maxItems || MAX_FETCH_ITEMS;
    var list = entries ? entries.slice(0) : [];
    if (pending && pending.length)
        list = list.concat(pending);
    if (list.length > limit)
        list = list.slice(list.length - limit);
    return list;
}

function entriesPerPage(frame) {
    return Math.max(1, frame ? frame.height : 1);
}

function formatFromLine(row) {
    var ts = formatTimestamp(row.when);
    var alias = row.from || "Unknown";
    var bbs = row.source ? " @" + row.source : "";
    var coloredAlias = "\1h\1y" + alias + "\1n";
    var coloredBbs = row.source ? "\1c@\1h\1g" + row.source + "\1n" : "";
    return "\1w" + ts + "\1n " + coloredAlias + coloredBbs + "\1h\1w:\1n";
}

function formatTimestamp(epoch) {
    if (!epoch) return "--/-- --:--";
    var d = new Date(epoch * 1000);
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function clipLine(text, width) {
    width = Math.max(1, width || 1);
    text = String(text || "");
    if (text.length > width) {
        if (width <= 3) return text.substr(0, width);
        return text.substr(0, width - 3) + "...";
    }
    return text;
}

function makeHeaderGroupId(hdr) {
    if (!hdr) return "msg-" + Date.now();
    if (typeof hdr.number !== "undefined") return "msg-num-" + hdr.number;
    if (hdr.id) return "msg-id-" + hdr.id;
    if (hdr.when_written_time) return "msg-time-" + hdr.when_written_time;
    var composite = (hdr.subject || "") + "|" + (hdr.from || "") + "|" + (hdr.to || "");
    return "msg-hash-" + composite;
}

function makePendingGroupId() {
    return "pending-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}

function loadBannerArt(frame) {
    if (!frame) return;
    var base = (typeof root !== "undefined" && root) ? root : ((typeof js === "object" && js && js.exec_dir) ? js.exec_dir : "");
    if (base && base.charAt(base.length - 1) !== "/" && base.charAt(base.length - 1) !== "\\") base += "/";
    var file = base + BANNER_FILE;
    try { frame.load(file, frame.width, frame.height); } catch (e) { }
}

function clipPad(s, w) {
    s = String(s || "");
    if (s.length > w) return s.substr(0, Math.max(0, w - 3)) + "...";
    while (s.length < w) s += " ";
    return s;
}

function repeat(ch, n) {
    var result = "";
    for (var i = 0; i < n; i++) result += ch;
    return result;
}

function putXY(frame, x, y, text, attr) {
    frame.gotoxy(x, y);
    frame.putmsg(String(text || ""), attr || 0);
}

function putAligned(frame, y, text, attr) {
    var blockWidth = Math.min(80, frame.width - 2);
    var leftX = centerLeftX(frame, blockWidth) + 1;  // small inset
    gotoxySafe(frame, leftX, y);
    frame.putmsg(String(text || ""), attr || 0);
}

function putCentered(frame, y, text, attr) {
    frame.gotoxy(1, y);
    frame.center(String(text || ""), attr || 0);
}

function putRightAligned(frame, y, text, attr, width) {
    var blockWidth = Math.min(width || 80, frame.width - 2);
    var leftX = centerLeftX(frame, blockWidth) + 1;
    var s = String(text || "");
    var startX = leftX + Math.max(0, blockWidth - s.length);
    gotoxySafe(frame, startX, y);
    frame.putmsg(s, attr || 0);
}

function setFooterMessage(footer, pending, message) {
    if (!footer) return;
    footer.clear();
    var pendingText = "\1wPending: " + ((pending && pending.length) || 0) + "\1n";
    var base = footerCommand("P", "Post") + "  " +
        footerCommand("Q/Esc/Enter", "Quit", true) + "   " + pendingText;
    var text = message || base;
    if (text.indexOf("\1n") === -1) text += "\1n";
    var blockWidth = Math.min(footer.width - 2, 80);
    var extraPadding = Math.max(0, parseInt((console.screen_columns - blockWidth) / 2));
    var usable = Math.max(1, blockWidth);
    var leftX = 2 + extraPadding;
    footer.gotoxy(leftX, 1);
    footer.putmsg(clipPad(text, usable), TABLE_THEME.footerText);
    footer.gotoxy(leftX, 2);
    footer.putmsg(clipPad("", usable), TABLE_THEME.footerText);
    footer.draw();
}

function footerCommand(label, word, keepWord) {
    var bracketColor = "\1c";
    var keyColor = "\1h\1m";
    var textColor = "\1h\1w";
    var reset = "\1n";
    var displayWord = keepWord ? word : word.substr(1);
    return bracketColor + "[" + keyColor + label + bracketColor + "]" + textColor + displayWord + reset;
}

function promptFooterInput(footer, promptText) {
    if (!footer) return "";
    var prompt = (promptText || "") + " ";
    var blockWidth = Math.min(footer.width - 2, 80);
    var extraPadding = Math.max(0, parseInt((console.screen_columns - blockWidth) / 2));
    var usable = Math.max(1, blockWidth);
    var clipped = clipPad(prompt, usable);
    footer.clear();
    var leftX = 2 + extraPadding;
    footer.gotoxy(leftX, 1);
    footer.putmsg(clipped, TABLE_THEME.footerText);
    footer.gotoxy(leftX, 2);
    footer.putmsg(clipPad("", usable), TABLE_THEME.footerText);
    footer.draw();
    var inputCol = leftX;
    var absX = footer.x + inputCol - 1;
    if (absX > footer.x + footer.width - 1) absX = footer.x + footer.width - 1;
    var absY = footer.y + 1;
    console.gotoxy(absX, absY);
    var maxInput = Math.min(MAX_LEN, ENTRY_MAX_LEN);
    var value = console.getstr(maxInput);
    return value === null ? "" : value;
}

function formatFullTimestamp(epoch) {
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var d = new Date(epoch * 1000);
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return days[d.getDay()] + " " + months[d.getMonth()] + " " + d.getDate() + " " +
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + " " + d.getFullYear();
}

function saveOnelinerBatch(pending) {
    if (!pending || !pending.length)
        return true;
    var info = getAuthorContext();
    var mb = new MsgBase(SUB_CODE);
    if (!mb.open())
        return false;
    var header = {
        to: RECIPIENT,
        from: info.alias,
        from_ext: info.number,
        subject: SUBJ,
        when_written_time: info.now
    };
    var ok = mb.save_msg(header, buildMessageBody(info, pending));
    mb.close();
    return !!ok;
}

function buildPendingEntry(rawText, groupId) {
    var info = getAuthorContext();
    return {
        text: trim(stripPipeCodes(rawText)),
        raw: rawText,
        from: info.alias,
        source: info.source,
        when: info.now,
        pending: true,
        groupId: groupId || makePendingGroupId()
    };
}

function getAuthorContext() {
    var alias = (typeof user !== "undefined" && user && (user.alias || user.name)) || "InterBBS User";
    var source = (typeof system !== "undefined" && system && system.name) || "Unknown BBS";
    var number = (typeof user !== "undefined" && user && user.number) ? user.number : 0;
    var qwk = (typeof system !== "undefined" && system && system.qwk_id) ? String(system.qwk_id).toLowerCase() : "";
    var host = (typeof system !== "undefined" && system && (system.host_name || system.inet_addr)) ? trim(system.host_name || system.inet_addr) : "";
    var now = typeof time === "function" ? time() : Math.floor(Date.now() / 1000);
    return {
        alias: alias,
        source: source,
        number: number,
        qwk: qwk,
        host: host,
        now: now
    };
}

function buildMessageBody(info, pending) {
    var lines = [];
    lines.push("InterBBS Oneliner");
    lines.push("");
    var fromLine = "From " + info.alias;
    if (info.qwk)
        fromLine += "@" + info.qwk;
    fromLine += " to " + RECIPIENT + " on " + formatFullTimestamp(info.now);
    lines.push(fromLine);
    lines.push("Author: " + info.alias);
    lines.push("");
    lines.push("Source: " + info.source);
    lines.push("");
    for (var i = 0; i < pending.length; i++) {
        var bodyText = pending[i].raw || pending[i].text;
        lines.push("Oneliner: " + bodyText);
        lines.push("");
    }
    if (info.host)
        lines.push("* Origin: " + info.source + " (" + info.host + ")");
    return lines.join("\r\n") + "\r\n";
}

function parseOnelinerLines(body, hdr) {
    var lines = body.split(/\r?\n/);
    var author = "";
    var source = "";
    var result = [];
    for (var i = 0; i < lines.length; i++) {
        var line = stripPipeCodes(stripCtrl(lines[i]));
        if (!trim(line))
            continue;
        var mAuthor = line.match(/^\s*Author:\s*(.+)$/i);
        if (mAuthor) {
            author = trim(mAuthor[1]);
            continue;
        }
        var mSource = line.match(/^\s*Source:\s*(.+)$/i);
        if (mSource) {
            source = trim(mSource[1]);
            continue;
        }
        var m = line.match(/^\s*Oneliner:\s*(.+)$/i);
        if (m) {
            var text = trim(stripPipeCodes(m[1]));
            if (!text)
                continue;
            result.push({
                text: text,
                from: trim(stripPipeCodes(author || hdr.from || source || "")),
                source: trim(stripPipeCodes(source)),
                when: hdr.when_written_time || 0
            });
        }
    }
    return result;
}

function stripCtrl(str) {
    return String(str || "").replace(/[\x00-\x1f\x7f]/g, "");
}

function trim(str) {
    return String(str || "").replace(/^\s+|\s+$/g, "");
}

function stripPipeCodes(str) {
    return String(str || "").replace(/\|[0-9a-f]{1,2}/ig, "");
}
