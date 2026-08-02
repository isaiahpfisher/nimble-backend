// Filling in what the page already told us.
//
// The prompt asks the model to pass the project it is looking at, and mostly it
// does. But "mostly" is the problem: `list_sprints({})` with the projectId left
// out is a tool failure, and a failure it then apologises for instead of
// correcting. The server knew the answer the whole time.
//
// So the page context is applied as a default rather than as an instruction.
// Nothing here overrides the model: a value it supplied always wins, and the
// only gap that gets filled is one that would otherwise be an error.

const FIELDS = ["projectId", "storyId", "sprintId"];

/**
 * Which page-context fields each tool *requires*, by tool name.
 *
 * Required is the whole test. A required `projectId` the model omitted is a
 * call that cannot work, so filling it can only turn a failure into an answer.
 * An *optional* one means something — get_people and find_stale_stories both
 * span every project when it is left out — and quietly narrowing those to the
 * project on screen would answer a different question than the one asked.
 */
function requiredContextFields(tools) {
  const map = new Map();

  for (const tool of tools) {
    const required = new Set(tool.parameters?.required ?? []);
    map.set(
      tool.name,
      FIELDS.filter((field) => required.has(field)),
    );
  }

  return map;
}

/**
 * The model's arguments, with any required page-context field it left out.
 *
 * @param {object} args     whatever the model produced
 * @param {Array}  fields   the context fields this tool requires
 * @param {object} context  what is on screen ({projectId, storyId, sprintId})
 */
function applyContext(args, fields, context) {
  if (!fields?.length) return args;

  const filled = { ...args };
  for (const field of fields) {
    // `== null` on purpose: an explicit null is as absent as undefined here,
    // and neither would satisfy a required number
    if (filled[field] == null && context?.[field] != null) filled[field] = context[field];
  }

  return filled;
}

/**
 * Wraps a callTool so every call arrives with the page's ids already in place.
 *
 * @param {Function} callTool  (name, args) => outcome
 * @param {Array}    tools     the tool specs, for their required fields
 * @param {object}   context   what is on screen
 */
function withPageContext(callTool, tools, context) {
  const required = requiredContextFields(tools);

  return (name, args) => callTool(name, applyContext(args ?? {}, required.get(name), context));
}

module.exports = { withPageContext, applyContext, requiredContextFields, FIELDS };
