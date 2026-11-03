/**
 * Inspector guidance for each check: what to look for, what photo to take, and where on the car it
 * is. Indian cars are right-hand drive: RHS is the driver's side.
 */

/** Areas of the top-down car diagram. */
export type CarZone =
  | "bumper_front"
  | "hood"
  | "engine_bay"
  | "cross_member"
  | "apron_rhs"
  | "apron_lhs"
  | "fender_rhs"
  | "fender_lhs"
  | "windscreen"
  | "pillar_a_rhs"
  | "pillar_a_lhs"
  | "door_front_rhs"
  | "door_rear_rhs"
  | "door_front_lhs"
  | "door_rear_lhs"
  | "pillar_b_rhs"
  | "pillar_b_lhs"
  | "running_board_rhs"
  | "running_board_lhs"
  | "quarter_rhs"
  | "quarter_lhs"
  | "roof"
  | "rear_glass"
  | "tailgate"
  | "boot"
  | "bumper_rear"
  | "exhaust"
  | "wheel_fr"
  | "wheel_fl"
  | "wheel_rr"
  | "wheel_rl"
  | "spare"
  | "mirror_rhs"
  | "mirror_lhs"
  | "dashboard"
  | "obd_port"
  | "seats_front"
  | "seats_rear"
  | "floor"
  | "underbody";

export interface Guide {
  /** What to look for, and what each answer means. */
  check: string;
  /** The photo to take, when the check has one. */
  capture?: string;
  zones?: CarZone[];
}

export const SECTION_GUIDES: Record<string, Guide> = {
  vehicle_details: {
    check: "Match the car to its papers before anything else: number plates, make, model and variant on the RC. Note anything that doesn't agree.",
    zones: ["bumper_front", "bumper_rear", "dashboard"],
  },
  documents: {
    check: "Ask for the original RC, insurance policy, service book and sale papers. Check names, dates and numbers against each other and against the car.",
  },
  engine: {
    check: "Inspect with the engine cold first (coolant, oil, radiator cap), then start it and watch for smoke, noise and vibration. Look under the car for fresh drips.",
    zones: ["engine_bay", "hood"],
  },
  transmission: {
    check: "Mostly a road test: clutch bite and slip, gear changes in every gear including reverse, and noises. Look under the car for gear-oil leaks and torn axle boots.",
    zones: ["underbody", "wheel_fr", "wheel_fl"],
  },
  suspension: {
    check: "Look behind each wheel for oily shock absorbers. Push down hard on each corner: it should rise once and settle. Listen for knocks over bumps on the road test.",
    zones: ["wheel_fr", "wheel_fl", "wheel_rr", "wheel_rl"],
  },
  steering: {
    check: "On the road test the steering should be light, return to centre, and the car should run straight with the wheel centred. Listen for knocks at full lock.",
    zones: ["dashboard", "engine_bay"],
  },
  brakes: {
    check: "Look at each disc through the wheel spokes, check the brake fluid, and on the road test brake firmly from 40 km/h: the car should stop straight without noise or pulsing.",
    zones: ["wheel_fr", "wheel_fl", "wheel_rr", "wheel_rl"],
  },
  electricals: {
    check: "With the engine running, try every switch: lamps, wipers, windows, AC, horn, locks. Note any warning lamp that stays on after starting.",
    zones: ["dashboard", "engine_bay"],
  },
  body_panels: {
    check: "Walk around the car in daylight. Look along each panel at an angle for ripples, shade differences and overspray; check panel gaps are even. A paint-thickness gauge confirms repaints.",
  },
  structure: {
    check: "Structural damage means a serious accident. Look for bent, welded, wrinkled or freshly painted metal in the aprons, cross member and underbody, and replaced bolts or sealant.",
    zones: ["apron_rhs", "apron_lhs", "cross_member", "underbody"],
  },
  glass: {
    check: "Check each glass for cracks, chips and scratches in the wiper or driver's view. Mismatched brand or year marks on one glass can mean it was replaced after an accident.",
  },
  tyres: {
    check: "Measure tread depth in the main grooves with a gauge (1.6 mm is the legal minimum). Look at the sidewalls for cuts and bulges, and compare wear across each tyre's width.",
    zones: ["wheel_fr", "wheel_fl", "wheel_rr", "wheel_rl", "spare"],
  },
  interior: {
    check: "Check wear against the odometer: a worn steering wheel, pedals and driver's seat on a low-km car can mean the odometer was rolled back.",
    zones: ["dashboard", "seats_front", "seats_rear", "floor"],
  },
  flood: {
    check: "Flood cars hide water damage. Look for rust, silt or a waterline in places that never get wet, and smell for damp or mould. Any sign means a serious risk of electrical faults.",
    zones: ["floor", "seats_front", "seats_rear", "boot", "dashboard"],
  },
};

const side = (s: "rhs" | "lhs") => (s === "rhs" ? "right (driver's)" : "left (passenger)");

function panel(zone: CarZone, name: string): Guide {
  return {
    check: `Look along the ${name} at a low angle in daylight. Shade or texture different from the next panel, overspray on rubber, uneven gaps or ripples mean repainting or repair. Press lightly for dents.`,
    capture: `The whole ${name} from about 2 m, at a slight angle so reflections show any ripples. Add a close-up of any dent or scratch.`,
    zones: [zone],
  };
}

function glass(zone: CarZone, name: string): Guide {
  return {
    check: `Check the ${name} for cracks, chips and scratches. Read the small brand mark in the corner: a different brand or year from the other glass means it was replaced.`,
    capture: `The ${name} straight on, plus a close-up of the brand mark in the corner.`,
    zones: [zone],
  };
}

function tread(zone: CarZone, name: string): Guide {
  return {
    check: `Measure the ${name} tread in the middle and both edges with a tread gauge. Enter the lowest reading in mm. Below 3 mm needs replacing soon; below 1.6 mm is illegal. Look for cuts or bulges on the sidewall.`,
    capture: "The tread with the gauge in a groove, close enough to read the gauge. Add a photo of the sidewall showing the size and manufacturing date (four digits, week then year).",
    zones: [zone],
  };
}

function rim(zone: CarZone, name: string): Guide {
  return {
    check: `Check the ${name} rim for kerb rash, cracks, bends and welding. A bent rim causes vibration at speed.`,
    capture: `The whole ${name} wheel face-on, plus a close-up of any damage.`,
    zones: [zone],
  };
}

function shock(zone: CarZone, name: string): Guide {
  return {
    check: `Look behind the ${name} wheel at the shock absorber body. A wet, oily or dust-caked shock is leaking. Push that corner down hard: more than one bounce means it is worn.`,
    capture: "The shock absorber body behind the wheel, with a torch if it's dark.",
    zones: [zone],
  };
}

function brake(zone: CarZone, name: string): Guide {
  return {
    check: `Look at the ${name} disc through the spokes: deep grooves or a raised lip at the edge mean wear. On the road test, listen for grinding and feel for pulsing in the pedal.`,
    zones: [zone],
  };
}

function flood(zones: CarZone[], where: string, look: string): Guide {
  return {
    check: `Check ${where} for ${look}. These places never get wet in normal use, so rust, silt or a damp smell there points to water damage.`,
    capture: `${where[0].toUpperCase()}${where.slice(1)}, close up, with a torch.`,
    zones,
  };
}

export const ITEM_GUIDES: Record<string, Guide> = {
  // Vehicle details
  reg_no: {
    check: "Read the number on both plates and match it to the RC. Plates should be high-security (HSRP) with the chakra hologram and a laser code.",
    capture: "The front number plate, straight on and readable.",
    zones: ["bumper_front", "bumper_rear"],
  },
  make: { check: "From the badge and the RC. Make sure they match." },
  model: { check: "From the badge and the RC. Make sure they match." },
  variant: { check: "From the badge on the tailgate and the features fitted. Sellers sometimes claim a higher variant." },
  colour: { check: "As on the RC. A different colour on the car than on the RC means a full repaint." },
  fuel_type: { check: "As on the RC. For CNG, check the RC lists CNG and look for the cylinder and its test certificate.", zones: ["boot"] },
  transmission: { check: "Manual if there is a clutch pedal; automatic includes AMT, CVT, DCT and torque-converter gearboxes." },
  mfg_month_year: { check: "From the RC, or the sticker on the door pillar. It can be months earlier than the registration date." },
  odometer: {
    check: "Read the odometer with the ignition on. Compare with the service book and wear on the pedals, steering wheel and seat: heavy wear on low km is a warning sign.",
    capture: "The instrument cluster with the ignition on, odometer digits sharp and readable.",
    zones: ["dashboard"],
  },

  // Documents and history
  rc: {
    check: "Ask for the original RC (smart card or book). Match the registration, chassis and engine numbers, owner name and fuel type to the car and the seller.",
    capture: "Both sides of the RC, flat, in good light, every line readable. You can also scan it to fill in the details.",
  },
  registration_date: { check: "From the RC. It sets the car's age for insurance, resale and the 15-year registration limit." },
  seating_capacity: { check: "From the RC. It should match the seats fitted." },
  rto: { check: "The RTO code is the first four characters of the registration (e.g. KA01). A car from another state may need an NOC and re-registration." },
  insurance: {
    check: "Ask for the current policy. Check the registration and chassis number on it match the car.",
    capture: "The first page of the policy showing insurer, policy number, dates and vehicle details. You can also scan it to fill in the details.",
  },
  insurance_type: { check: "Comprehensive covers own damage; third-party covers only others. Check for a zero-depreciation add-on." },
  insurance_expiry: { check: "From the policy. An expired policy means the car can't legally be driven, and a lapse can cost the no-claim bonus." },
  owners: { check: "The owner serial number on the RC. More owners usually means a lower value." },
  hypothecation: { check: "If the RC shows a bank under hypothecation, the loan must be closed and the bank's NOC and Form 35 provided before transfer." },
  sale_letter: { check: "A signed sale letter or delivery note from the previous sale, if the seller isn't the first owner." },
  rc_owner_contact: { check: "The registered owner's phone number, to confirm the sale with them if the seller is someone else." },
  noc: { check: "Needed for cars moving states or with a closed loan. Not needed for a local car with no loan." },
  parivahan_check: { check: "Search the registration on the Parivahan or mParivahan app and compare owner count, insurance, fitness and pollution validity with the papers." },
  challan: { check: "Search pending e-challans on the Parivahan e-challan site. Pending fines must be cleared before transfer." },
  blacklist: { check: "The Parivahan check shows if the vehicle is blacklisted (e.g. stolen, unpaid tax, court order). A blacklisted car can't be transferred." },
  service_history: { check: "Ask for the service book or the dealer's service records. Gaps or missing records are a reason to inspect more closely." },
  periodic_service: { check: "Compare service dates and kms against the maker's schedule (usually every 10,000 km or yearly)." },
  accident_repair_history: { check: "Look in the service records and insurance claims for body repairs or major claims." },
  major_mech_repair_history: { check: "Look in the records for engine, gearbox or clutch overhauls." },
  chassis_no: {
    check: "Find the chassis (VIN) number stamped on the body (often under the passenger seat or in the engine bay) and on the plate by the door. It must match the RC exactly. Signs of grinding or re-stamping are serious.",
    capture: "The stamped chassis number, close up and readable, lit from the side with a torch.",
    zones: ["engine_bay", "floor"],
  },
  engine_no: {
    check: "Find the engine number stamped on the engine block. It must match the RC. A mismatch means the engine was replaced without updating the RC.",
    capture: "The stamped engine number, close up and readable.",
    zones: ["engine_bay"],
  },
  place_of_inspection: { check: "Where the inspection happened, e.g. the seller's home or a dealer's yard." },

  // Engine
  radiator_intercooler: {
    check: "Look at the radiator fins for damage, blockage and green or white crust from leaks. A new radiator on an older car can mean a front-end accident.",
    capture: "The radiator through the front grille or from above.",
    zones: ["engine_bay"],
  },
  leakage: {
    check: "With a torch, look at the engine, gaskets and the ground under the car for fresh oil (brown/black), coolant (green, pink or blue) or fuel. Old dry stains matter less than wet ones.",
    capture: "Any wet area or drip, close up. If none, the underside of the engine from below.",
    zones: ["engine_bay", "underbody"],
  },
  radiator_cap: { check: "Engine cold only. Open the cap: coolant should be clean and full. Oil or a milky film in the coolant suggests a head-gasket problem.", zones: ["engine_bay"] },
  air_filter: { check: "Open the air-filter box. A very dirty filter suggests skipped servicing; water or silt inside is a flood sign.", zones: ["engine_bay"] },
  coolant: { check: "Level between MIN and MAX in the reservoir, clean colour. Brown or oily coolant is a problem.", zones: ["engine_bay"] },
  engine_oil: {
    check: "Pull the dipstick: oil between the marks, brown to black but not thick sludge. Look under the oil filler cap for milky deposit.",
    capture: "The dipstick tip held against a white tissue, and the underside of the oil filler cap.",
    zones: ["engine_bay"],
  },
  compression_leak: { check: "With the engine running, open the oil filler cap. Heavy smoke or puffing (blow-by) means worn piston rings. A compression test confirms it.", zones: ["engine_bay"] },
  vibration: { check: "At idle, with AC off and on, watch the engine and feel the steering and seat. Strong shaking can mean worn engine mounts or a misfire.", zones: ["engine_bay", "dashboard"] },
  engine_noise: { check: "Listen at idle and when revving: knocking, ticking, whining or rattling at cold start are warning signs.", zones: ["engine_bay"] },
  smoke: { check: "Watch the exhaust at cold start and when revving. White steady smoke: coolant burning. Blue: oil burning. Black: too much fuel. Brief white vapour on a cold morning is normal.", zones: ["exhaust"] },
  hoses: {
    check: "Squeeze the radiator and heater hoses (engine cold). Cracks, bulges or soft spongy hoses need replacing.",
    capture: "The main radiator hoses and their clamps.",
    zones: ["engine_bay"],
  },
  belts: {
    check: "Look at the drive belt for cracks, glazing and fraying. A squeal at start means it's loose or worn.",
    capture: "The drive belt, showing its ribbed side if you can.",
    zones: ["engine_bay"],
  },

  // Transmission
  gear_oil_leak: { check: "Look under the gearbox for wet oil. A few dry old stains are less of a concern.", zones: ["underbody"] },
  axle_boots: { check: "Turn the steering to full lock and look at the rubber boots behind the front wheels. Torn boots leak grease and let dirt in.", zones: ["wheel_fr", "wheel_fl"] },
  prop_shaft: { check: "Rear- and four-wheel-drive only. Look for play in the joints and listen for clunks when pulling away.", zones: ["underbody"] },
  differential_front: { check: "Four-wheel-drive only. Look for leaks and listen for whining on the road.", zones: ["underbody"] },
  differential_rear: { check: "Rear- and four-wheel-drive only. Look for leaks and listen for whining on the road.", zones: ["underbody"] },
  clutch: { check: "The clutch should bite in the middle of the pedal travel. Test for slip: in 3rd gear at low speed, press the accelerator hard. If revs rise but speed doesn't, the clutch is slipping." },
  gear_shifting: { check: "Every gear, including reverse, should engage smoothly without grinding or popping out. For automatics, shifts should be smooth with no slipping or harsh jerks." },
  trans_noise: { check: "Listen for whining that changes with speed, or clunks when changing gear." },

  // Suspension
  shock_leak_fr: shock("wheel_fr", "front-right"),
  shock_leak_fl: shock("wheel_fl", "front-left"),
  shock_leak_rr: shock("wheel_rr", "rear-right"),
  shock_leak_rl: shock("wheel_rl", "rear-left"),
  noise_front: { check: "Drive over speed breakers and rough road slowly with the windows down. Knocks or creaks from the front point to worn bushes, links or shocks.", zones: ["wheel_fr", "wheel_fl"] },
  noise_rear: { check: "As for the front, listening for noises from the back of the car.", zones: ["wheel_rr", "wheel_rl"] },
  comfort: { check: "On a normal road the ride should feel controlled. Bouncing or floating after bumps means worn shock absorbers." },

  // Steering
  ps_fluid_leak: { check: "Hydraulic power steering only: look at the reservoir and hoses for leaks. Most newer cars have electric steering with no fluid.", zones: ["engine_bay"] },
  alignment: { check: "On a straight, flat road the car should run straight with the steering wheel centred. Uneven wear on the front tyres also points to bad alignment.", zones: ["wheel_fr", "wheel_fl"] },
  ps_condition: { check: "Steering should be light at parking speed and return to centre after a turn. Heavy or notchy steering is a problem." },
  steering_noise: { check: "Turn the wheel from lock to lock while stationary and slowly moving. Clicks, groans or knocks need checking." },

  // Brakes
  brake_fr: brake("wheel_fr", "front-right"),
  brake_fl: brake("wheel_fl", "front-left"),
  brake_rr: brake("wheel_rr", "rear-right"),
  brake_rl: brake("wheel_rl", "rear-left"),
  brake_fluid: { check: "Level between MIN and MAX in the reservoir. Fresh fluid is light amber; dark brown fluid is old and should be changed.", zones: ["engine_bay"] },
  side_pull: { check: "Brake firmly from about 40 km/h on a straight, empty road with a light grip on the wheel. The car should stop straight." },
  hand_brake: { check: "On a slope, the hand brake should hold the car within a few clicks. Too many clicks means it needs adjusting." },

  // Electricals
  battery_serial: { check: "The serial or date code on the battery label shows its age. Batteries usually last 3–4 years." },
  battery: {
    check: "Look for corrosion on the terminals, a bulging case and the manufacture date. Slow cranking at start points to a weak battery.",
    capture: "The battery top with its label and terminals visible.",
    zones: ["engine_bay"],
  },
  alternator: { check: "With the engine running, battery voltage should be about 13.5–14.5 V (the Drive tab shows it when an adapter is connected)." },
  starter: { check: "The engine should crank briskly and start quickly. Grinding or clicking means a starter problem." },
  fuse_boxes: { check: "Open the fuse boxes. Missing fuses, wrong ratings or added wiring are signs of electrical problems or poorly fitted accessories.", zones: ["engine_bay", "dashboard"] },
  ac_flow: { check: "All fan speeds should work and blow from every vent setting." },
  ac_temp: { check: "After a few minutes the centre vents should blow clearly cold air." },
  abs: { check: "The ABS lamp should light briefly at start and go out. If it stays on, the ABS has a fault (standard OBD can't read ABS codes)." },
  horn: { check: "Press the horn: it should sound loud and clear." },
  head_lamps: { check: "Low and high beam on both sides. Hazy or yellowed lenses reduce light; one new lens can mean a front-end repair.", zones: ["bumper_front"] },
  indicators: { check: "Front, rear and side indicators on both sides, plus hazard lights. A fast blink means a bulb is out." },
  brake_lamps: { check: "Have someone watch from behind while you press the brake: both lamps and the high-mounted lamp should light.", zones: ["bumper_rear"] },
  wiper: { check: "All speeds and the washer spray. Streaking means worn blades.", zones: ["windscreen"] },
  fog_lamps: { check: "If fitted, front and rear fog lamps light." },
  power_windows: { check: "Every window from its own switch and from the driver's master switch, all the way up and down. Auto-up should stop if something is in the way." },
  sunroof: { check: "If fitted, opens and closes fully. Look for water stains on the roof lining.", zones: ["roof"] },
  roof_lamp: { check: "Lights from the switch and when a door opens.", zones: ["roof"] },
  ventilation: { check: "Fresh-air and recirculation modes switch, and air comes from every vent." },
  heating: { check: "With the engine warm, set the temperature to hot: warm air should come through within a minute." },
  orvm_auto_fold: { check: "If fitted, both mirrors fold and unfold from the switch or on locking.", zones: ["mirror_rhs", "mirror_lhs"] },
  ventilated_seats: { check: "If fitted, each fan speed blows air through the seat.", zones: ["seats_front"] },
  infotainment: { check: "Screen responds to touch, radio, Bluetooth pairing, USB and all speakers. Dead pixels or a frozen screen are expensive to fix.", zones: ["dashboard"] },
  reverse_parking: { check: "In reverse, the sensors beep as you approach an object and the camera image is clear.", zones: ["bumper_rear"] },
  cruise_adas: { check: "If fitted, cruise control sets and holds speed on the road test. Note any ADAS warning messages." },
  central_locking: { check: "All doors and the boot lock and unlock from the key remote and the inside switch." },
  keyless_entry: { check: "If fitted, the doors unlock with the key in your pocket and the car starts with the button." },
  ecu_scan: { check: "Plug in the OBD adapter (usually under the steering wheel) with the ignition on, connect on the Drive tab, then tap Read codes. Stored codes mean confirmed faults.", zones: ["obd_port"] },
  warning_lamps: {
    check: "Turn the ignition on: all lamps light. After starting, every warning lamp should go out. Any lamp still lit means a fault.",
    capture: "The instrument cluster with the engine running, all lamps visible.",
    zones: ["dashboard"],
  },

  // Body panels
  hood: panel("hood", "hood"),
  roof: panel("roof", "roof"),
  fender_rhs: panel("fender_rhs", `${side("rhs")} fender`),
  a_pillar_rhs: panel("pillar_a_rhs", `${side("rhs")} A-pillar`),
  front_door_rhs: panel("door_front_rhs", `${side("rhs")} front door`),
  b_pillar_rhs: panel("pillar_b_rhs", `${side("rhs")} B-pillar`),
  rear_door_rhs: panel("door_rear_rhs", `${side("rhs")} rear door`),
  running_board_rhs: panel("running_board_rhs", `${side("rhs")} running board (sill below the doors)`),
  c_pillar_quarter_rhs: panel("quarter_rhs", `${side("rhs")} rear quarter panel`),
  tailgate: panel("tailgate", "tailgate or boot lid"),
  c_pillar_quarter_lhs: panel("quarter_lhs", `${side("lhs")} rear quarter panel`),
  running_board_lhs: panel("running_board_lhs", `${side("lhs")} running board (sill below the doors)`),
  rear_door_lhs: panel("door_rear_lhs", `${side("lhs")} rear door`),
  b_pillar_lhs: panel("pillar_b_lhs", `${side("lhs")} B-pillar`),
  front_door_lhs: panel("door_front_lhs", `${side("lhs")} front door`),
  a_pillar_lhs: panel("pillar_a_lhs", `${side("lhs")} A-pillar`),
  fender_lhs: panel("fender_lhs", `${side("lhs")} fender`),
  bumper_front: panel("bumper_front", "front bumper"),
  bumper_rear: panel("bumper_rear", "rear bumper"),

  // Structure
  underbody: {
    check: "From below with a torch: look for bent or dented chassis rails, fresh welding, heavy rust, or new underbody coating hiding repairs.",
    capture: "The underbody from the front and rear, with any damage or welding close up.",
    zones: ["underbody"],
  },
  apron_rhs: {
    check: `Open the bonnet and look at the ${side("rhs")} apron (the inner panel beside the engine). Wrinkles, fresh paint, non-factory welds or sealant mean front-end accident repair.`,
    capture: `The ${side("rhs")} apron from above, showing its full length.`,
    zones: ["apron_rhs"],
  },
  apron_lhs: {
    check: `Open the bonnet and look at the ${side("lhs")} apron (the inner panel beside the engine). Wrinkles, fresh paint, non-factory welds or sealant mean front-end accident repair.`,
    capture: `The ${side("lhs")} apron from above, showing its full length.`,
    zones: ["apron_lhs"],
  },
  front_cross_member: {
    check: "Look at the cross member behind the front bumper and radiator. Bends, welds or replaced bolts mean a front-end impact.",
    capture: "The cross member from above with the bonnet open.",
    zones: ["cross_member"],
  },

  // Glass and mirrors
  windscreen: glass("windscreen", "windscreen"),
  glass_front_door_rhs: glass("door_front_rhs", `${side("rhs")} front door glass`),
  glass_rear_door_rhs: glass("door_rear_rhs", `${side("rhs")} rear door glass`),
  glass_quarter_rhs: glass("quarter_rhs", `${side("rhs")} quarter glass`),
  glass_tailgate: glass("rear_glass", "rear glass"),
  glass_quarter_lhs: glass("quarter_lhs", `${side("lhs")} quarter glass`),
  glass_rear_door_lhs: glass("door_rear_lhs", `${side("lhs")} rear door glass`),
  glass_front_door_lhs: glass("door_front_lhs", `${side("lhs")} front door glass`),
  rubber_beadings: { check: "Door and window rubber seals should be intact and soft. Torn or hardened seals let in water and noise." },
  extra_fittings: { check: "Note aftermarket accessories: alloys, lights, music systems, CNG kits. Poorly wired electrical accessories can cause faults; some affect insurance." },
  irvm: { check: "Mirror firmly mounted, glass intact, auto-dimming working if fitted.", zones: ["windscreen"] },
  orvm_rhs: { check: "Mirror housing, glass and electric adjustment and folding working.", zones: ["mirror_rhs"] },
  orvm_lhs: { check: "Mirror housing, glass and electric adjustment and folding working.", zones: ["mirror_lhs"] },

  // Wheels and tyres
  tyre_fr: tread("wheel_fr", "front-right"),
  tyre_rr: tread("wheel_rr", "rear-right"),
  tyre_rl: tread("wheel_rl", "rear-left"),
  tyre_fl: tread("wheel_fl", "front-left"),
  tyre_spare: tread("spare", "spare"),
  front_tyre_wear: {
    check: "Compare the inner, middle and outer tread on both front tyres. Wear on one edge points to alignment or suspension problems.",
    capture: "Each front tyre's full tread width, with the steering turned to full lock so it's visible.",
    zones: ["wheel_fr", "wheel_fl"],
  },
  tyre_overall: { check: "Sidewall cracks, bulges, mismatched brands and tyres over about 5 years old (from the date code) all count against the tyres." },
  rim_fr: rim("wheel_fr", "front-right"),
  rim_rr: rim("wheel_rr", "rear-right"),
  rim_rl: rim("wheel_rl", "rear-left"),
  rim_fl: rim("wheel_fl", "front-left"),
  rim_spare: rim("spare", "spare"),

  // Interior
  seats: { check: "Upholstery tears, stains, and seat adjustment and recline working. Compare driver's seat wear with the odometer.", zones: ["seats_front", "seats_rear"] },
  dashboard: { check: "Cracks, loose trim, and signs the dashboard was removed (scratched screws, gaps) after an airbag deployment.", zones: ["dashboard"] },
  door_pads: { check: "Door trims intact, armrests and switches working." },
  roof_liner: { check: "Sagging or water stains on the roof lining can mean leaks from the sunroof or windscreen.", zones: ["roof"] },
  floor_mats: { check: "Lift the mats: damp carpet or rust underneath is a warning sign.", zones: ["floor"] },
  tool_kit: { check: "Tool kit present in the boot: wheel spanner and towing hook.", zones: ["boot"] },
  jack: { check: "Jack present and working.", zones: ["boot"] },
  duplicate_key: { check: "Ask for the second key and test it, including the remote. A replacement key can be expensive." },

  // Flood signs
  rusted_bolts: flood(["seats_front", "floor"], "the seat-mounting bolts and the bolts under the dashboard", "rust"),
  under_front_seat: flood(["seats_front"], "under the front seats", "rust, silt and damp carpet"),
  under_rear_seat: flood(["seats_rear"], "under the rear seat (lift the cushion if it unclips)", "rust, silt and damp carpet"),
  floor_panel: flood(["floor"], "the floor under the carpet at a corner", "rust, silt or a tide mark"),
  inside_dashboard: flood(["dashboard"], "behind the glovebox and under the dashboard", "silt, rust on brackets and corroded connectors"),
  inside_boot: flood(["boot", "spare"], "the spare-wheel well under the boot floor", "standing water, silt or rust"),
  inside_ac_vent: flood(["dashboard"], "inside the AC vents", "silt or a musty smell when the fan runs"),
  inside_air_filter: flood(["engine_bay"], "the engine air-filter box", "water marks or silt"),
  inside_body_panel: flood(["door_front_rhs", "door_front_lhs"], "inside the door bottoms and behind the door trims", "silt and rust"),
};

/** The guide for a check, falling back to its section's guide. */
export function getGuide(sectionKey: string, itemKey: string): Guide | undefined {
  return ITEM_GUIDES[itemKey] ?? SECTION_GUIDES[sectionKey];
}
