# TorqDrop PPI checklist v1

This list is taken from a sample Indian "Know Your Car" inspection report. It becomes `lib/diagnostics/checklists/ppi-v1.ts`.

Every item also allows `not_applicable` and `not_inspected` (with a reason). "Labels" are the status words shown to users. They map to `good | acceptable | attention | defect`.

Flags: **C** = critical (blocks completion while `not_started`), **P** = photo required, **AI** = AI photo assist, **OBD** = linked to OBD data, **M** = measured value.

## 1. Vehicle details
| Key | Item | Input | Flags |
| --- | --- | --- | --- |
| reg_no | Registration number | text | C, P (RC) |
| make / model / variant | Make, model, variant | text | C |
| colour | Colour | text | |
| fuel_type | Fuel type | petrol / diesel / CNG / EV / hybrid | C |
| transmission | Transmission | manual / automatic | C |
| mfg_month_year | Manufacturing month/year | month-year | |
| odometer | Odometer reading (km) | number | C, P, AI (dashboard read), M |

## 2. Documents and history
| Key | Item | Labels | Flags |
| --- | --- | --- | --- |
| rc | RC | original available → good · copy available → attention · not available → defect | C, P |
| registration_date | Date of registration | date | |
| seating_capacity | Seating capacity | number | |
| rto | RTO | text | |
| insurance | Insurance | original / copy / not available | P |
| insurance_type | Insurance type | comprehensive / third-party | |
| insurance_expiry | Insurance expiry | date (expired → attention) | |
| owners | Number of owners | number | |
| hypothecation | Hypothecation | none → good · active → attention | |
| sale_letter | Sale letter | available / not available | |
| rc_owner_contact | RC owner contact | text | |
| noc | NOC | available / not required / missing | |
| parivahan_check | Parivahan (VAHAN) check | done / not done | |
| challan | Pending challans | none → good · pending → attention | |
| blacklist | Blacklist | not listed → good · listed → defect | C |
| service_history | Vehicle service history | available / not available | |
| periodic_service | Periodic service as per history | yes / partial / no | |
| accident_repair_history | Accident repair as per history | none / found | |
| major_mech_repair_history | Major mechanical repair as per history | none / found | |
| chassis_no | Chassis number | verified → good · mismatch → defect | C, P |
| engine_no | Engine number | verified → good · mismatch → defect | C, P |
| place_of_inspection | Place of inspection | text | |

## 3. Engine
| Key | Item | Labels | Flags |
| --- | --- | --- | --- |
| radiator_intercooler | Radiator / intercooler | good / ok / bad | P |
| leakage | Leakage (oil/fuel/coolant) | no → good · yes → defect | C, P, AI |
| radiator_cap | Radiator cap open check | good / bad | |
| air_filter | Air filter | good / dirty / bad | |
| coolant | Coolant | good / low / contaminated | OBD (coolant temp) |
| engine_oil | Engine oil | good / low / sludge | P |
| compression_leak | Compression leak | no → good · yes → defect | C |
| vibration | Abnormal vibration | ok / present | OBD (RPM at idle) |
| engine_noise | Abnormal engine noise | ok / present | |
| smoke | Smoke | not visible → good · white/blue/black → defect | |
| hoses | Hoses | good / ok / cracked | P |
| belts | Belts | good / ok / worn | P |

## 4. Transmission
gear_oil_leak, axle_boots, prop_shaft, differential_front, differential_rear, clutch (C), gear_shifting (C), trans_noise. Labels: ok / attention / defect.

## 5. Suspension
shock_leak_fr, shock_leak_fl, shock_leak_rr, shock_leak_rl, noise_front, noise_rear, comfort. Labels: ok / leak / noisy.

## 6. Steering
ps_fluid_leak, alignment (normal / off), ps_condition (smooth / heavy), steering_noise (normal / present).

## 7. Brakes (critical section)
brake_fr, brake_fl, brake_rr, brake_rl, brake_fluid, side_pull (no / yes), hand_brake. Labels: good / ok / worn / defect.

## 8. Electricals
battery_serial, battery (P), alternator, starter, fuse_boxes, ac_flow, ac_temp, abs (available-working / not working / not fitted), **ecu_scan (C, OBD: trouble codes + check-engine light; good = no codes; any stored or pending code → attention/defect, with the codes attached)**, **warning_lamps (P, AI dashboard photo, OBD MIL)**, horn, head_lamps, indicators, brake_lamps, wiper, fog_lamps, power_windows, sunroof, roof_lamp, ventilation, heating, orvm_auto_fold, ventilated_seats, infotainment, reverse_parking, cruise_adas, central_locking, keyless_entry.

## 9. Body panels (two values per panel)
`paint`: original → good · scratched / dented → attention · repainted → attention
`structure`: good · repaired → attention · replaced → defect

Panels (each P, AI): hood, roof, fender_rhs, a_pillar_rhs, front_door_rhs, b_pillar_rhs, rear_door_rhs, running_board_rhs, c_pillar_quarter_rhs, tailgate, c_pillar_quarter_lhs, running_board_lhs, rear_door_lhs, b_pillar_lhs, front_door_lhs, a_pillar_lhs, fender_lhs, bumper_front, bumper_rear.

## 10. Structure and underbody (critical section)
underbody, apron_rhs, apron_lhs, front_cross_member. Labels: ok / repaired / damaged. All P.

## 11. Glass, mirrors and fittings
windscreen, glass_front_door_rhs, glass_rear_door_rhs, glass_quarter_rhs, glass_tailgate, glass_quarter_lhs, glass_rear_door_lhs, glass_front_door_lhs, rubber_beadings, extra_fittings (not done → good · done → attention + remarks), irvm, orvm_rhs, orvm_lhs.

## 12. Wheels and tyres (critical section)
| Key | Item | Input | Flags |
| --- | --- | --- | --- |
| tyre_fr / tyre_rr / tyre_rl / tyre_fl / tyre_spare | Tread depth | mm (show % remaining) | M, P, AI |
| front_tyre_wear | Abnormal front tyre wear | normal / uneven | P, AI |
| tyre_overall | Overall tyre condition | good / ok / replace | |
| rim_fr / rim_rr / rim_rl / rim_fl / rim_spare | Alloy / disc | good / ok / damaged | P |

## 13. Interior and accessories
seats, dashboard, door_pads, roof_liner, floor_mats, tool_kit, jack, duplicate_key. Labels: good / worn / missing.

## 14. Flood signs (critical section)
rusted_bolts, under_front_seat, under_rear_seat, floor_panel, inside_dashboard, inside_boot, inside_ac_vent, inside_air_filter, inside_body_panel. Labels: no signs → good · signs → defect. All P, AI (visible rust or silt).

## Sign-off
- `inspected_by` + timestamp (always)
- `approved_by` + timestamp (B2B orgs with an approver role)
- certification status: approved / approved with remarks / not approved
