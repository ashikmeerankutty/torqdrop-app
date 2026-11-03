import type { Checklist, ChoiceOption, ItemDef, ItemInput, Rating } from "./types";

// Source: docs/checklist-ppi-v1.md. Flags: critical (C), photo (P), ai (AI), obd (OBD).

const choice = (...options: [string, Rating][]): ItemInput => ({
  kind: "choice",
  options: options.map(([label, rating]): ChoiceOption => ({ label, rating })),
});

const text: ItemInput = { kind: "text" };
const date: ItemInput = { kind: "date" };

type Flags = Partial<Pick<ItemDef, "critical" | "photo" | "ai" | "obd">>;
const item = (key: string, label: string, input: ItemInput, flags: Flags = {}): ItemDef => ({ key, label, input, ...flags });

/** Many sections share one label set across a list of keys. */
const same = (input: ItemInput, flags: Flags, entries: [string, string][]): ItemDef[] =>
  entries.map(([key, label]) => item(key, label, input, flags));

const P = { photo: true };
const PAI = { photo: true, ai: true };

const GOOD_OK_BAD = choice(["Good", "good"], ["OK", "acceptable"], ["Bad", "defect"]);
const NO_YES_DEFECT = choice(["No", "good"], ["Yes", "defect"]);
const OK_PRESENT = choice(["OK", "good"], ["Present", "attention"]);
const AVAILABLE = choice(["Available", "good"], ["Not available", "attention"]);
const WORKING = choice(["Working", "good"], ["Needs attention", "attention"], ["Not working", "defect"]);
const TRANSMISSION = choice(["OK", "good"], ["Attention", "attention"], ["Defect", "defect"]);
const BRAKE = choice(["Good", "good"], ["OK", "acceptable"], ["Worn", "attention"], ["Defect", "defect"]);
const GLASS = choice(["Good", "good"], ["Scratched", "attention"], ["Cracked", "defect"]);
const MIRROR = choice(["Good", "good"], ["Damaged", "attention"]);
const RIM = choice(["Good", "good"], ["OK", "acceptable"], ["Damaged", "attention"]);
const INTERIOR = choice(["Good", "good"], ["Worn", "acceptable"], ["Missing", "attention"]);
const STRUCTURE = choice(["OK", "good"], ["Repaired", "attention"], ["Damaged", "defect"]);
const FLOOD = choice(["No signs", "good"], ["Signs", "defect"]);

export const PPI_V1: Checklist = {
  version: "ppi-v1",
  sections: [
    {
      key: "vehicle_details",
      title: "Vehicle details",
      items: [
        item("reg_no", "Registration number", text, { critical: true, photo: true }),
        item("make", "Make", text, { critical: true }),
        item("model", "Model", text, { critical: true }),
        item("variant", "Variant", text),
        item("colour", "Colour", text),
        item(
          "fuel_type",
          "Fuel type",
          choice(["Petrol", "good"], ["Diesel", "good"], ["CNG", "good"], ["EV", "good"], ["Hybrid", "good"]),
          { critical: true },
        ),
        item("transmission", "Transmission", choice(["Manual", "good"], ["Automatic", "good"]), { critical: true }),
        item("mfg_month_year", "Manufacturing month/year", { kind: "text", placeholder: "MM/YYYY" }),
        item("odometer", "Odometer reading", { kind: "number", unit: "km" }, { critical: true, photo: true, ai: true }),
      ],
    },
    {
      key: "documents",
      title: "Documents and history",
      items: [
        item(
          "rc",
          "RC",
          choice(["Original available", "good"], ["Copy available", "attention"], ["Not available", "defect"]),
          { critical: true, photo: true },
        ),
        item("registration_date", "Date of registration", date),
        item("seating_capacity", "Seating capacity", { kind: "number" }),
        item("rto", "RTO", text),
        item("insurance", "Insurance", choice(["Original", "good"], ["Copy", "acceptable"], ["Not available", "attention"]), P),
        item("insurance_type", "Insurance type", choice(["Comprehensive", "good"], ["Third-party", "acceptable"])),
        item("insurance_expiry", "Insurance expiry", { kind: "date", expiry: true }),
        item("owners", "Number of owners", { kind: "number" }),
        item("hypothecation", "Hypothecation", choice(["None", "good"], ["Active", "attention"])),
        item("sale_letter", "Sale letter", AVAILABLE),
        item("rc_owner_contact", "RC owner contact", text),
        item("noc", "NOC", choice(["Available", "good"], ["Not required", "good"], ["Missing", "attention"])),
        item("parivahan_check", "Parivahan (VAHAN) check", choice(["Done", "good"], ["Not done", "attention"])),
        item("challan", "Pending challans", choice(["None", "good"], ["Pending", "attention"])),
        item("blacklist", "Blacklist", choice(["Not listed", "good"], ["Listed", "defect"]), { critical: true }),
        item("service_history", "Vehicle service history", AVAILABLE),
        item("periodic_service", "Periodic service as per history", choice(["Yes", "good"], ["Partial", "acceptable"], ["No", "attention"])),
        item("accident_repair_history", "Accident repair as per history", choice(["None", "good"], ["Found", "attention"])),
        item("major_mech_repair_history", "Major mechanical repair as per history", choice(["None", "good"], ["Found", "attention"])),
        item("chassis_no", "Chassis number", choice(["Verified", "good"], ["Mismatch", "defect"]), { critical: true, photo: true }),
        item("engine_no", "Engine number", choice(["Verified", "good"], ["Mismatch", "defect"]), { critical: true, photo: true }),
        item("place_of_inspection", "Place of inspection", text),
      ],
    },
    {
      key: "engine",
      title: "Engine",
      critical: true,
      items: [
        item("radiator_intercooler", "Radiator / intercooler", GOOD_OK_BAD, P),
        item("leakage", "Leakage (oil/fuel/coolant)", NO_YES_DEFECT, { critical: true, photo: true, ai: true }),
        item("radiator_cap", "Radiator cap open check", choice(["Good", "good"], ["Bad", "defect"])),
        item("air_filter", "Air filter", choice(["Good", "good"], ["Dirty", "attention"], ["Bad", "defect"])),
        item("coolant", "Coolant", choice(["Good", "good"], ["Low", "attention"], ["Contaminated", "defect"]), { obd: true }),
        item("engine_oil", "Engine oil", choice(["Good", "good"], ["Low", "attention"], ["Sludge", "defect"]), P),
        item("compression_leak", "Compression leak", NO_YES_DEFECT, { critical: true }),
        item("vibration", "Abnormal vibration", OK_PRESENT, { obd: true }),
        item("engine_noise", "Abnormal engine noise", OK_PRESENT),
        item(
          "smoke",
          "Smoke",
          choice(["Not visible", "good"], ["White", "defect"], ["Blue", "defect"], ["Black", "defect"]),
        ),
        item("hoses", "Hoses", choice(["Good", "good"], ["OK", "acceptable"], ["Cracked", "defect"]), P),
        item("belts", "Belts", choice(["Good", "good"], ["OK", "acceptable"], ["Worn", "attention"]), P),
      ],
    },
    {
      key: "transmission",
      title: "Transmission",
      items: [
        ...same(TRANSMISSION, {}, [
          ["gear_oil_leak", "Gear oil leak"],
          ["axle_boots", "Axle boots"],
          ["prop_shaft", "Propeller shaft"],
          ["differential_front", "Front differential"],
          ["differential_rear", "Rear differential"],
        ]),
        item("clutch", "Clutch", TRANSMISSION, { critical: true }),
        item("gear_shifting", "Gear shifting", TRANSMISSION, { critical: true }),
        item("trans_noise", "Transmission noise", TRANSMISSION),
      ],
    },
    {
      key: "suspension",
      title: "Suspension",
      items: [
        ...same(choice(["OK", "good"], ["Leak", "attention"]), P, [
          ["shock_leak_fr", "Shock absorber leak, front right"],
          ["shock_leak_fl", "Shock absorber leak, front left"],
          ["shock_leak_rr", "Shock absorber leak, rear right"],
          ["shock_leak_rl", "Shock absorber leak, rear left"],
        ]),
        ...same(choice(["OK", "good"], ["Noisy", "attention"]), {}, [
          ["noise_front", "Front suspension noise"],
          ["noise_rear", "Rear suspension noise"],
        ]),
        item("comfort", "Ride comfort", choice(["Good", "good"], ["Fair", "acceptable"], ["Poor", "attention"])),
      ],
    },
    {
      key: "steering",
      title: "Steering",
      items: [
        item("ps_fluid_leak", "Power-steering fluid leak", NO_YES_DEFECT),
        item("alignment", "Alignment", choice(["Normal", "good"], ["Off", "attention"])),
        item("ps_condition", "Steering condition", choice(["Smooth", "good"], ["Heavy", "attention"])),
        item("steering_noise", "Steering noise", choice(["Normal", "good"], ["Present", "attention"])),
      ],
    },
    {
      key: "brakes",
      title: "Brakes",
      critical: true,
      items: [
        ...same(BRAKE, { critical: true }, [
          ["brake_fr", "Brake, front right"],
          ["brake_fl", "Brake, front left"],
          ["brake_rr", "Brake, rear right"],
          ["brake_rl", "Brake, rear left"],
        ]),
        item("brake_fluid", "Brake fluid", choice(["Good", "good"], ["Low", "attention"], ["Contaminated", "defect"]), { critical: true }),
        item("side_pull", "Pulls to one side", choice(["No", "good"], ["Yes", "attention"]), { critical: true }),
        item("hand_brake", "Hand brake", BRAKE, { critical: true }),
      ],
    },
    {
      key: "electricals",
      title: "Electricals",
      items: [
        item("battery_serial", "Battery serial number", text),
        item("battery", "Battery", WORKING, P),
        ...same(WORKING, {}, [
          ["alternator", "Alternator"],
          ["starter", "Starter motor"],
          ["fuse_boxes", "Fuse boxes"],
          ["ac_flow", "AC air flow"],
          ["ac_temp", "AC cooling"],
        ]),
        item("abs", "ABS", choice(["Available, working", "good"], ["Not working", "defect"])),
        item(
          "ecu_scan",
          "ECU scan (trouble codes)",
          choice(["No codes", "good"], ["Pending codes", "attention"], ["Stored codes", "defect"]),
          { critical: true, obd: true },
        ),
        item("warning_lamps", "Dashboard warning lamps", choice(["None lit", "good"], ["Lamp lit", "attention"]), {
          photo: true,
          ai: true,
          obd: true,
        }),
        ...same(WORKING, {}, [
          ["horn", "Horn"],
          ["head_lamps", "Head lamps"],
          ["indicators", "Indicators"],
          ["brake_lamps", "Brake lamps"],
          ["wiper", "Wipers"],
          ["fog_lamps", "Fog lamps"],
          ["power_windows", "Power windows"],
          ["sunroof", "Sunroof"],
          ["roof_lamp", "Roof lamp"],
          ["ventilation", "Ventilation"],
          ["heating", "Heating"],
          ["orvm_auto_fold", "ORVM auto-fold"],
          ["ventilated_seats", "Ventilated seats"],
          ["infotainment", "Infotainment"],
          ["reverse_parking", "Reverse parking sensors/camera"],
          ["cruise_adas", "Cruise control / ADAS"],
          ["central_locking", "Central locking"],
          ["keyless_entry", "Keyless entry"],
        ]),
      ],
    },
    {
      key: "body_panels",
      title: "Body panels",
      items: same({ kind: "panel" }, PAI, [
        ["hood", "Hood"],
        ["roof", "Roof"],
        ["fender_rhs", "Fender, RHS"],
        ["a_pillar_rhs", "A-pillar, RHS"],
        ["front_door_rhs", "Front door, RHS"],
        ["b_pillar_rhs", "B-pillar, RHS"],
        ["rear_door_rhs", "Rear door, RHS"],
        ["running_board_rhs", "Running board, RHS"],
        ["c_pillar_quarter_rhs", "C-pillar / quarter panel, RHS"],
        ["tailgate", "Tailgate"],
        ["c_pillar_quarter_lhs", "C-pillar / quarter panel, LHS"],
        ["running_board_lhs", "Running board, LHS"],
        ["rear_door_lhs", "Rear door, LHS"],
        ["b_pillar_lhs", "B-pillar, LHS"],
        ["front_door_lhs", "Front door, LHS"],
        ["a_pillar_lhs", "A-pillar, LHS"],
        ["fender_lhs", "Fender, LHS"],
        ["bumper_front", "Front bumper"],
        ["bumper_rear", "Rear bumper"],
      ]),
    },
    {
      key: "structure",
      title: "Structure and underbody",
      critical: true,
      items: same(STRUCTURE, { critical: true, photo: true }, [
        ["underbody", "Underbody"],
        ["apron_rhs", "Apron, RHS"],
        ["apron_lhs", "Apron, LHS"],
        ["front_cross_member", "Front cross member"],
      ]),
    },
    {
      key: "glass",
      title: "Glass, mirrors and fittings",
      items: [
        ...same(GLASS, P, [
          ["windscreen", "Windscreen"],
          ["glass_front_door_rhs", "Front door glass, RHS"],
          ["glass_rear_door_rhs", "Rear door glass, RHS"],
          ["glass_quarter_rhs", "Quarter glass, RHS"],
          ["glass_tailgate", "Tailgate glass"],
          ["glass_quarter_lhs", "Quarter glass, LHS"],
          ["glass_rear_door_lhs", "Rear door glass, LHS"],
          ["glass_front_door_lhs", "Front door glass, LHS"],
        ]),
        item("rubber_beadings", "Rubber beadings", choice(["Good", "good"], ["Worn", "attention"])),
        item("extra_fittings", "Aftermarket fittings", choice(["Not done", "good"], ["Done", "attention"])),
        ...same(MIRROR, {}, [
          ["irvm", "Inside rear-view mirror"],
          ["orvm_rhs", "Outside mirror, RHS"],
          ["orvm_lhs", "Outside mirror, LHS"],
        ]),
      ],
    },
    {
      key: "tyres",
      title: "Wheels and tyres",
      critical: true,
      items: [
        ...same({ kind: "tread" }, { critical: true, photo: true, ai: true }, [
          ["tyre_fr", "Tread depth, front right"],
          ["tyre_rr", "Tread depth, rear right"],
          ["tyre_rl", "Tread depth, rear left"],
          ["tyre_fl", "Tread depth, front left"],
          ["tyre_spare", "Tread depth, spare"],
        ]),
        item("front_tyre_wear", "Abnormal front tyre wear", choice(["Normal", "good"], ["Uneven", "attention"]), PAI),
        item("tyre_overall", "Overall tyre condition", choice(["Good", "good"], ["OK", "acceptable"], ["Replace", "attention"])),
        ...same(RIM, P, [
          ["rim_fr", "Rim, front right"],
          ["rim_rr", "Rim, rear right"],
          ["rim_rl", "Rim, rear left"],
          ["rim_fl", "Rim, front left"],
          ["rim_spare", "Rim, spare"],
        ]),
      ],
    },
    {
      key: "interior",
      title: "Interior and accessories",
      items: same(INTERIOR, {}, [
        ["seats", "Seats"],
        ["dashboard", "Dashboard"],
        ["door_pads", "Door pads"],
        ["roof_liner", "Roof liner"],
        ["floor_mats", "Floor mats"],
        ["tool_kit", "Tool kit"],
        ["jack", "Jack"],
        ["duplicate_key", "Duplicate key"],
      ]),
    },
    {
      key: "flood",
      title: "Flood signs",
      critical: true,
      items: same(FLOOD, { critical: true, ...PAI }, [
        ["rusted_bolts", "Rusted bolts"],
        ["under_front_seat", "Under front seats"],
        ["under_rear_seat", "Under rear seats"],
        ["floor_panel", "Floor panel"],
        ["inside_dashboard", "Inside dashboard"],
        ["inside_boot", "Inside boot"],
        ["inside_ac_vent", "Inside AC vents"],
        ["inside_air_filter", "Inside air filter"],
        ["inside_body_panel", "Inside body panels"],
      ]),
    },
  ],
};

export function getSection(key: string) {
  return PPI_V1.sections.find((s) => s.key === key);
}
