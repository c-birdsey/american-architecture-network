// Fixed vocabulary this app knows how to draw/label -- not user-editable
// data (unlike the graph's nodes/edges, which live in Firestore), same
// reasoning as ENTRY_SHAPE_BY_PRIMATIVE in the archive app's NetworkPage:
// these are part of this page's visual language, not archive content.

// Node kind -> shape + label. Monochrome (no color-by-kind, matching the
// "no color-coding" house style) -- shape alone carries the distinction.
export const NODE_KIND = {
  person: { label: "Person", shape: "circle" },
  practice: { label: "Practice", shape: "square" },
  award: { label: "Prize / Cohort", shape: "diamond" },
  school: { label: "School", shape: "triangle" },
};

// Edge kind -> physics distance/strength/weight, plus direction-aware
// relationship labels for the detail panel ("out" = this node is the
// source of the edge, "in" = this node is the target).
export const EDGE_KIND = {
  office: { dist: 46, strength: 0.35, weight: 1.5, labelOut: "Employed", labelIn: "Worked For" },
  studio: { dist: 52, strength: 0.35, weight: 1.5, labelOut: "Taught", labelIn: "Studied Under" },
  partner: { dist: 34, strength: 0.35, weight: 1.4, labelOut: "Partners", labelIn: "Partners" },
  hire: { dist: 58, strength: 0.35, weight: 1.3, labelOut: "Recruited", labelIn: "Recruited By" },
  faculty: { dist: 70, strength: 0.35, weight: 1.0, labelOut: "Teaches At", labelIn: "Faculty" },
  seat: { dist: 60, strength: 0.35, weight: 1.8, labelOut: "Led", labelIn: "Led By" },
  principal: { dist: 26, strength: 0.7, weight: 1.0, labelOut: "Principal Of", labelIn: "Principals" },
  honor: { dist: 78, strength: 0.12, weight: 0.8, labelOut: "Recognised By", labelIn: "Recognises" },
};

// The order relationship groups are shown in the detail panel -- lineage
// first, then practice, then schools, honors last.
export const RELATIONSHIP_ORDER = [
  "Studied Under", "Worked For", "Taught", "Employed",
  "Recruited", "Recruited By", "Partners",
  "Principal Of", "Principals",
  "Led", "Led By", "Teaches At", "Faculty",
  "Recognised By", "Recognises",
];

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
