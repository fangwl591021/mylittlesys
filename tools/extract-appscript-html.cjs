const fs = require("fs");

const source = fs.readFileSync("appscript_source.html", "utf8");
const match = source.match(/goog\.script\.init\(("(?:\\.|[^"])*")/);

if (!match) {
  console.error("Could not find goog.script.init payload.");
  process.exit(1);
}

const payload = JSON.parse(eval(match[1]));
fs.writeFileSync("index.extracted.html", payload.userHtml);

console.log(JSON.stringify({
  functionNames: payload.functionNames,
  htmlLength: payload.userHtml.length,
  title: (payload.userHtml.match(/<title>([^<]*)/) || [])[1] || ""
}, null, 2));
