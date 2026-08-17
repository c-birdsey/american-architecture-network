// Fixed vocabulary this app knows how to draw/label -- not user-editable
// data (unlike the graph's nodes/edges, which live in Firestore), same
// reasoning as ENTRY_SHAPE_BY_PRIMATIVE in the archive app's NetworkPage:
// these are part of this page's visual language, not archive content.

// Node kind -> shape + label. Default rendering is monochrome (shape
// alone carries the distinction, matching the "no color-coding" house
// style) -- `color` is only used when the "Colorize" toggle is on
// (NetworkPage.jsx), as an alternate reading of the same graph. Person is
// deliberately left black in both modes -- it's the majority kind, so
// colorizing it would read as noise rather than signal; the accent
// colors are for picking the minority kinds out of the crowd. Palette is
// a first draft, adapted from the original reference's dark-background
// hues for legibility on white -- open to retuning.
export const NODE_KIND = {
  person: { label: "Person", shape: "circle" },
  practice: { label: "Practice", shape: "square", color: "#c47f2e" },
  award: { label: "Prize / Cohort", shape: "diamond", color: "#a8862c" },
  school: { label: "School", shape: "triangle", color: "#7350c9" },
};

// Edge kind -> physics distance/strength/weight, direction-aware
// relationship labels for the detail panel ("out" = this node is the
// source of the edge, "in" = this node is the target), and a color used
// only when "Colorize" is on -- otherwise every edge draws black.
export const EDGE_KIND = {
  office: { dist: 46, strength: 0.35, weight: 1.5, labelOut: "Employed", labelIn: "Worked For", color: "#c47f2e" },
  studio: { dist: 52, strength: 0.35, weight: 1.5, labelOut: "Taught", labelIn: "Studied Under", color: "#1f8fae" },
  partner: { dist: 34, strength: 0.35, weight: 1.4, labelOut: "Partners", labelIn: "Partners", color: "#c23f74" },
  hire: { dist: 58, strength: 0.35, weight: 1.3, labelOut: "Recruited", labelIn: "Recruited By", color: "#3f9c56" },
  faculty: { dist: 70, strength: 0.35, weight: 1.0, labelOut: "Teaches At", labelIn: "Faculty", color: "#7350c9" },
  seat: { dist: 60, strength: 0.35, weight: 1.8, labelOut: "Led", labelIn: "Led By", color: "#7350c9" },
  principal: { dist: 26, strength: 0.7, weight: 1.0, labelOut: "Principal Of", labelIn: "Principals", color: "#5c7086" },
  honor: { dist: 78, strength: 0.12, weight: 0.8, labelOut: "Recognised By", labelIn: "Recognises", color: "#a8862c" },
  // Person -> school: attended/graduated from, as a student -- distinct
  // from `faculty` (taught there) and `seat` (led/chaired it).
  trained: { dist: 70, strength: 0.35, weight: 1.0, labelOut: "Trained At", labelIn: "Alumni", color: "#7350c9" },
};

// The order relationship groups are shown in the detail panel -- lineage
// first, then practice, then schools, honors last.
export const RELATIONSHIP_ORDER = [
  "Studied Under", "Worked For", "Taught", "Employed",
  "Recruited", "Recruited By", "Partners",
  "Principal Of", "Principals",
  "Trained At", "Alumni",
  "Led", "Led By", "Teaches At", "Faculty",
  "Recognised By", "Recognises",
];

// The 5 named views from the static reference -- each is just a starting
// { edgeKinds, nodeKinds, hideOrphans, onlyNow } combination, applied as
// one atomic swap (see applyPreset in NetworkPage.jsx). "Everything" is
// the default/reset state.
export const VIEW_PRESETS = {
  all: {
    label: "Everything",
    edgeKinds: Object.keys(EDGE_KIND),
    nodeKinds: Object.keys(NODE_KIND),
    hideOrphans: false,
    onlyNow: false,
  },
  lineage: {
    label: "Lineage Only",
    edgeKinds: ["office", "studio", "partner", "hire"],
    nodeKinds: ["person"],
    hideOrphans: true,
    onlyNow: false,
  },
  prizes: {
    label: "Prize Network",
    edgeKinds: ["honor", "principal", "partner"],
    nodeKinds: ["person", "practice", "award"],
    hideOrphans: false,
    onlyNow: false,
  },
  schools: {
    label: "Schools",
    edgeKinds: ["seat", "faculty", "studio", "trained"],
    nodeKinds: ["person", "school"],
    hideOrphans: true,
    onlyNow: false,
  },
  now: {
    label: "Active Now",
    edgeKinds: Object.keys(EDGE_KIND),
    nodeKinds: Object.keys(NODE_KIND),
    hideOrphans: false,
    onlyNow: true,
  },
};

// House/cohort codes carried on nodes' `h` array -- the little taxonomy
// of schools-of-thought and prize programs this dataset organizes people
// and practices into. Fixed the same way NODE_KIND/EDGE_KIND are; extend
// here (and redeploy) if a new house/prize is added.
export const HOUSE = {
  BA: "Beaux-Arts",
  CHI: "Chicago School",
  PRA: "Wright & the Prairie",
  BAU: "Bauhaus at Harvard",
  IIT: "Mies & IIT",
  SOM: "SOM",
  PEN: "Kahn & Penn",
  YAL: "Yale",
  TEX: "Texas Rangers & Cornell",
  COO: "Cooper Union",
  NY5: "New York Five & the IAUS",
  CAL: "California Modern",
  LA: "SCI-Arc & Los Angeles",
  PRI: "Princeton",
  COL: "Columbia",
  GSD: "Harvard GSD",
  MIT: "MIT",
  DIG: "Digital & Research Practice",
  CHIc: "Chicago, Later",
  EV: "Emerging Voices",
  MCHAP: "Mies Crown Hall Americas Prize",
  STATE: "State AIA Firm Awards",
  SCHOOL: "School",
  HONOR: "National Honour",
};
