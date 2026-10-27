// Node types. Rank is how far "down" a type sits: links are expected to run upwards,
// so colleges (rank 0) end up in the middle of the network and each rank gets a wider ring.
export const TYPES = {
  college:   { label: "College", plural: "Colleges", rank: 0, color: "#4e79a7" },
  course:    { label: "Course", plural: "Courses", rank: 1, color: "#76b7b2", code: "Course code, e.g. CS110" },
  hc:        { label: "HC", plural: "HCs", rank: 2, color: "#e15759", code: "Hashtag, e.g. #sourcequality" },
  lo:        { label: "LO", plural: "LOs", rank: 2, color: "#f28e2c", code: "Hashtag, e.g. #cs110-codereadability" },
  reference: { label: "Reading / reference", plural: "Readings & references", rank: 3, color: "#59a14f" },
  note:      { label: "Note", plural: "Notes", rank: 3, color: "#af7aa1" },
  locref:    { label: "Location reference", plural: "Location references", rank: 4, color: "#9c755f" },
};
export const TYPE_ORDER = Object.keys(TYPES);

export const typeDot = type => `<span class="dot" style="background:${TYPES[type]?.color || "#999"}"></span>`;

/** "#sourcequality — Source quality", or just the title. */
export function nodeName(n) {
  const title = n.title || "Untitled";
  return n.code && n.code !== title ? `${n.code} — ${title}` : title;
}
/** Short label for the network: the code when there is one. */
export const nodeLabel = n => n.code || n.title || "Untitled";

/** An HC's handbook page: the link typed on the node, or one built from its code (#organization → …/organization/). */
const HANDBOOK = "https://my.minerva.edu/academics/hc-resources/hc-handbook/";
export const autoHandbook = n => {
  const tag = String(n.code || "").trim().replace(/^#/, "").toLowerCase();
  return tag ? `${HANDBOOK}${encodeURIComponent(tag)}/` : "";
};
export const handbookLink = n => n.type === "hc" ? (n.handbook || "").trim() || autoHandbook(n) : "";

// Minerva's five colleges, created with an empty notebook so there is a centre to link to.
export const SEED_COLLEGES = ["Arts & Humanities", "Business", "Computational Sciences", "Natural Sciences", "Social Sciences"];
