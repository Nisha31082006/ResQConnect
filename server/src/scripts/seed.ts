import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/db';
import {
  Assignment,
  Emergency,
  FoodAllocation,
  FoodProvider,
  FoodSupply,
  RescueTeam,
  RoadBlockage,
  Shelter,
  TeamMembership,
  User,
  allModels,
} from '../models';
import { createEmergencyDoc, transitionEmergency } from '../services/emergency.service';
import { detectDuplicates } from '../services/duplicate.service';
import { pointFrom } from '../utils/geo';
import { runAutomation } from '../services/automation/runner';

export const DEMO_PASSWORD = 'Demo@1234';

export const DEMO_USERS = [
  { key: 'admin', name: 'Anitha Coordinator', email: 'admin@resqconnect.test', role: 'admin', phone: '+919800000001', skills: [] as string[] },
  { key: 'citizen', name: 'Karthik Citizen', email: 'citizen@resqconnect.test', role: 'citizen', phone: '+919800000002', skills: [] },
  { key: 'citizen2', name: 'Meena Citizen', email: 'citizen2@resqconnect.test', role: 'citizen', phone: '+919800000003', skills: [] },
  { key: 'leader', name: 'Senthil Leader', email: 'leader@resqconnect.test', role: 'team_leader', phone: '+919800000004', skills: ['rescue', 'boat', 'first_aid'] },
  { key: 'leader2', name: 'Divya Leader', email: 'leader2@resqconnect.test', role: 'team_leader', phone: '+919800000005', skills: ['medical', 'first_aid'] },
  { key: 'vol1', name: 'Arun Volunteer', email: 'volunteer@resqconnect.test', role: 'volunteer', phone: '+919800000006', skills: ['rescue', 'first_aid'] },
  { key: 'vol2', name: 'Bhavani Volunteer', email: 'volunteer2@resqconnect.test', role: 'volunteer', phone: '+919800000007', skills: ['boat', 'swimming'] },
  { key: 'vol3', name: 'Chandru Volunteer', email: 'volunteer3@resqconnect.test', role: 'volunteer', phone: '+919800000008', skills: ['medical', 'driving'] },
  { key: 'vol4', name: 'Deepa Volunteer', email: 'volunteer4@resqconnect.test', role: 'volunteer', phone: '+919800000009', skills: ['logistics', 'driving'] },
  { key: 'food', name: 'Esakki Food Provider', email: 'food@resqconnect.test', role: 'food_provider', phone: '+919800000010', skills: [] },
  { key: 'shelter', name: 'Fathima Shelter Coordinator', email: 'shelter@resqconnect.test', role: 'shelter_coordinator', phone: '+919800000011', skills: [] },
] as const;

export async function seedDatabase(log: (msg: string) => void = () => undefined) {
  await Promise.all((allModels as unknown as { deleteMany: (f: object) => Promise<unknown> }[]).map((m) => m.deleteMany({})));
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.bcryptRounds);
  const users: Record<string, InstanceType<typeof User>> = {};
  for (const u of DEMO_USERS) {
    users[u.key] = await User.create({ name: u.name, email: u.email, phone: u.phone, role: u.role, skills: [...u.skills], passwordHash, status: 'active' });
  }
  const admin = users.admin;
  // Base locations (used by the distance part of the team recommendation).
  const home: Record<string, [number, number]> = { vol1: [13.0605, 80.2496], vol2: [13.0701, 80.2322], vol3: [13.0489, 80.2095], vol4: [13.1067, 80.2206], leader: [13.0605, 80.2496], leader2: [13.0418, 80.2341] };
  for (const [k, [lat, lng]] of Object.entries(home)) await User.updateOne({ _id: users[k]._id }, { homeLocation: pointFrom({ lat, lng }), locationUpdatedAt: new Date() });
  log(`Created ${DEMO_USERS.length} demo users`);

  // Teams (created by the administrator; membership is manual)
  const alpha = await RescueTeam.create({ name: 'Alpha Flood Rescue', leader: users.leader._id, skills: ['rescue', 'boat', 'swimming'], capacity: 5, createdBy: admin._id, lastLocation: pointFrom({ lat: 13.0605, lng: 80.2496 }), lastLocationAt: new Date() });
  const bravo = await RescueTeam.create({ name: 'Bravo Medical Response', leader: users.leader2._id, skills: ['medical', 'first_aid'], capacity: 4, createdBy: admin._id });
  const mk = (team: typeof alpha, user: (typeof users)[string], role: 'leader' | 'member') => ({ team: team._id, user: user._id, role, addedBy: admin._id });
  await TeamMembership.insertMany([mk(alpha, users.leader, 'leader'), mk(alpha, users.vol1, 'member'), mk(alpha, users.vol2, 'member'), mk(bravo, users.leader2, 'leader'), mk(bravo, users.vol3, 'member')]);
  log('Created 2 rescue teams');

  // Shelters
  await Shelter.insertMany([
    { name: 'Government Higher Secondary School Relief Camp', location: pointFrom({ lat: 13.0878, lng: 80.2785 }), address: 'Purasawalkam, Chennai', capacity: 300, occupancy: 120, facilities: ['water', 'food', 'toilets', 'bedding', 'wheelchair_access'], accessibilityNotes: 'Ground-floor halls, ramp at the main gate', contact: { name: 'Camp Office', phone: '+914400000001' }, status: 'open', coordinator: users.shelter._id, createdBy: admin._id },
    { name: 'Community Hall Relief Centre', location: pointFrom({ lat: 13.0418, lng: 80.2341 }), address: 'T. Nagar, Chennai', capacity: 150, occupancy: 150, facilities: ['water', 'food', 'medical'], contact: { phone: '+914400000002' }, status: 'full', coordinator: users.shelter._id, createdBy: admin._id },
    { name: 'Corporation Marriage Hall Shelter', location: pointFrom({ lat: 13.1067, lng: 80.2206 }), address: 'Perambur, Chennai', capacity: 200, occupancy: 40, facilities: ['water', 'toilets', 'power', 'bedding', 'women_children_area', 'pet_friendly'], contact: { phone: '+914400000003' }, status: 'open', createdBy: admin._id },
  ]);
  log('Created 3 shelters');

  // Food provider + supplies
  const provider = await FoodProvider.create({ name: 'Annapoorani Community Kitchen', owner: users.food._id, description: 'Cooked meals for relief camps', location: pointFrom({ lat: 13.0732, lng: 80.2609 }), address: 'Egmore, Chennai', operatingHours: '06:00 - 21:00', contact: { name: 'Esakki', phone: '+919800000010' } });
  const meals = await FoodSupply.create({ provider: provider._id, foodType: 'Rice and sambar meals', unit: 'meals', quantityTotal: 800, quantityAvailable: 800 });
  await FoodSupply.create({ provider: provider._id, foodType: 'Dry ration packages', unit: 'packages', quantityTotal: 200, quantityAvailable: 200 });
  log('Created food provider and supplies');

  // Emergencies
  const mkEm = async (kind: 'normal' | 'sos', reporter: (typeof users)[string], input: Record<string, unknown>, minutesAgo = 0) => {
    const em = await createEmergencyDoc({ kind, reporter: reporter._id, contact: { name: reporter.name, phone: reporter.phone }, occurredAt: new Date(Date.now() - minutesAgo * 60000), ...(input as object) } as never);
    if (minutesAgo > 0) {
      await em.collection.updateOne({ _id: em._id }, { $set: { createdAt: new Date(Date.now() - minutesAgo * 60000) } });
      em.createdAt = new Date(Date.now() - minutesAgo * 60000);
    }
    return em;
  };
  const e1 = await mkEm('sos', users.citizen, { type: 'trapped', description: 'Water has entered the ground floor. Family trapped on the first floor, elderly mother cannot walk.', affectedCount: 5, trappedCount: 3, citizenPriority: 'medium', dangerToLife: true, severity: 'severe', vulnerable: { elderly: true, children: true }, location: pointFrom({ lat: 13.0827, lng: 80.2707 }), address: 'Vepery, Chennai' }, 12);
  const e2 = await mkEm('sos', users.citizen2, { type: 'medical', description: 'Pregnant woman in labour pains, ambulance cannot reach because of flooded road.', affectedCount: 2, dangerToLife: true, severity: 'high', vulnerable: { pregnant: true }, location: pointFrom({ lat: 13.0489, lng: 80.2095 }), address: 'Saidapet, Chennai' }, 3);
  const e3 = await mkEm('normal', users.citizen, { type: 'flood', description: 'Street flooded knee-deep, around 40 families need drinking water and food packets.', affectedCount: 40, citizenPriority: 'low', severity: 'medium', assistanceNeeds: ['drinking_water', 'food'], location: pointFrom({ lat: 13.0836, lng: 80.2715 }), address: 'Vepery High Road, Chennai' }, 45);
  const e4 = await mkEm('normal', users.citizen2, { type: 'landslide', description: 'Mud slide blocking the lane near the hill; two houses damaged, no injuries reported.', affectedCount: 8, severity: 'medium', location: pointFrom({ lat: 13.1203, lng: 80.2998 }), address: 'Royapuram, Chennai' }, 120);
  const e5 = await mkEm('sos', users.citizen2, { type: 'fire', description: 'Short-circuit fire in a flooded building, residents evacuating.', affectedCount: 12, dangerToLife: true, severity: 'severe', location: pointFrom({ lat: 13.0569, lng: 80.2425 }), address: 'Mylapore, Chennai' }, 30);
  // Automation scenarios ------------------------------------------------------------------
  // Zone detection: more flood reports in the same Vepery neighbourhood within the time window.
  const z1 = await mkEm('normal', users.citizen2, { type: 'flood', description: 'Water rising fast in our lane near Vepery church, many houses affected.', affectedCount: 15, citizenPriority: 'high', severity: 'high', assistanceNeeds: ['food'], location: pointFrom({ lat: 13.0852, lng: 80.2731 }), address: 'Vepery Church Road, Chennai' }, 20);
  const z2 = await mkEm('normal', users.citizen, { type: 'flood', description: 'Ground floors under water along the canal side, families stuck upstairs.', affectedCount: 9, trappedCount: 4, citizenPriority: 'medium', severity: 'high', assistanceNeeds: ['medical_aid'], location: pointFrom({ lat: 13.0801, lng: 80.2693 }), address: 'Canal Bank Road, Vepery' }, 15);
  // Shelter + medical need (drives the shelter recommendation and the shelter shortage rule).
  const s1 = await mkEm('normal', users.citizen2, { type: 'shelter_needed', description: 'Houses collapsed in the rain; 25 people including children need a safe place to stay tonight.', affectedCount: 25, trappedCount: 0, citizenPriority: 'high', severity: 'high', vulnerable: { children: true, elderly: true }, assistanceNeeds: ['shelter', 'food', 'blankets', 'medical_aid'], location: pointFrom({ lat: 13.0905, lng: 80.2602 }), address: 'Kilpauk, Chennai' }, 25);
  // Workload: Arun already works with the Alpha team; two more direct assignments make him overloaded.
  const w1 = await mkEm('normal', users.citizen, { type: 'road_hazard', description: 'Fallen tree and live wire on the road near the market, people cannot pass.', affectedCount: 6, severity: 'medium', location: pointFrom({ lat: 13.0701, lng: 80.2322 }), address: 'Anna Salai market' }, 90);
  const w2 = await mkEm('normal', users.citizen2, { type: 'medical', description: 'Elderly man with chest pain at a relief point, needs first aid until the ambulance arrives.', affectedCount: 1, severity: 'high', assistanceNeeds: ['medical_aid'], location: pointFrom({ lat: 13.0501, lng: 80.2101 }), address: 'Saidapet relief point' }, 80);
  for (const e of [e1, e2, e3, e4, e5, z1, z2, s1, w1, w2]) await detectDuplicates(e);

  // e1: acknowledged, priority confirmed and assigned to Alpha team; e5: acknowledged and in progress
  await transitionEmergency(e1, 'acknowledged', admin, 'Seed: acknowledged');
  e1.finalPriority = { level: 'critical', decidedBy: admin._id, decidedAt: new Date(), overridden: false, recommendedLevelAtDecision: e1.recommendedPriority.level };
  e1.requiredVolunteers = 4;
  e1.requiredSkills = ['rescue', 'boat'];
  await e1.save();
  await Assignment.create({ emergency: e1._id, team: alpha._id, volunteers: [], instructions: 'Use the boat; elderly person needs a stretcher.', assignedBy: admin._id });
  await transitionEmergency(e1, 'assigned', admin, 'Seed: assigned to Alpha');
  await transitionEmergency(e3, 'acknowledged', admin, 'Seed: acknowledged');
  await transitionEmergency(s1, 'acknowledged', admin, 'Seed: acknowledged');
  for (const w of [w1, w2]) {
    await transitionEmergency(w, 'acknowledged', admin, 'Seed: acknowledged');
    w.finalPriority = { level: 'high', decidedBy: admin._id, decidedAt: new Date(), overridden: false, recommendedLevelAtDecision: w.recommendedPriority.level };
    await w.save();
    await Assignment.create({ emergency: w._id, volunteers: [users.vol1._id], instructions: 'Seed: direct assignment', assignedBy: admin._id });
    await transitionEmergency(w, 'assigned', admin, 'Seed: assigned');
  }
  // Follow-ups: the Alpha assignment has had no progress note for hours, a shelter was never refreshed, and e4 has waited unacknowledged.
  const staleSince = new Date(Date.now() - 3 * 3600000);
  await Assignment.updateOne({ emergency: e1._id }, { assignedAt: staleSince });
  await Emergency.collection.updateOne({ _id: e1._id }, { $set: { statusHistory: (e1.statusHistory as unknown as { at: Date }[]).map((h) => ({ ...JSON.parse(JSON.stringify(h)), at: staleSince })) } });
  await Shelter.collection.updateOne({ name: 'Community Hall Relief Centre' }, { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } });
  await Shelter.collection.updateOne({ name: 'Corporation Marriage Hall Shelter' }, { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } });
  log('Created 10 emergencies (3 SOS) with assignments and automation scenarios');

  // Road blockages
  await RoadBlockage.insertMany([
    { type: 'flooded', description: 'Waist-deep water, vehicles stalled', severity: 'severe', location: pointFrom({ lat: 13.0812, lng: 80.2689 }), address: 'Vepery Underpass', reportedBy: users.citizen._id, reporterRole: 'citizen', verificationStatus: 'verified', verifiedBy: admin._id, verifiedAt: new Date() },
    { type: 'fallen_tree', description: 'Large tree across both lanes', severity: 'medium', location: pointFrom({ lat: 13.0701, lng: 80.2322 }), address: 'Anna Salai', reportedBy: users.vol1._id, reporterRole: 'volunteer' },
    { type: 'landslide', description: 'Mud and rocks on the hill road', severity: 'high', location: pointFrom({ lat: 13.1195, lng: 80.3005 }), address: 'Royapuram Hill Road', reportedBy: users.citizen2._id, reporterRole: 'citizen' },
  ]);
  log('Created 3 road blockage reports');

  // A pending food request that the administrator still has to review
  await FoodAllocation.create({ emergency: e3._id, requestedBy: users.citizen._id, community: 'Vepery High Road residents', quantityRequested: 120, unit: 'meals', deliveryAddress: 'Vepery High Road, Chennai', status: 'requested', history: [{ status: 'requested', by: users.citizen._id, at: new Date() }] } as never);
  void meals;
  return { users };
}

async function main() {
  if (env.isProd) throw new Error('Refusing to seed (this wipes ALL data) while NODE_ENV=production.');
  await connectDatabase();
  console.log('Seeding database (existing data in this database is replaced)...');
  await seedDatabase((m) => console.log(' -', m));
  const run = await runAutomation();
  console.log(' - Ran automation: ' + `${run.zones?.created ?? 0} zone(s), ${run.resources?.created ?? 0} resource alert(s), ${run.followUps?.created ?? 0} follow-up(s), ${run.escalations?.created ?? 0} SOS escalation(s)`);
  if (run.errors.length) console.warn('   automation warnings:', run.errors);
  console.log('\nDemo accounts (password for all: ' + DEMO_PASSWORD + ')');
  DEMO_USERS.forEach((u) => console.log(`  ${u.role.padEnd(20)} ${u.email}`));
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nSeed failed:', (err as Error).message);
    process.exit(1);
  });
}
