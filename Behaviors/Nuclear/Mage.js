import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType as DispelType } from "@/Enums/Auras";

const auras = {
  fingersoffrost: 44544,
  winterschill: 228358,
  frozen: 378760
};

//# Executed before combat begins.Accepts non - harmful actions only.
//actions.precombat = flask
//actions.precombat += /food
//actions.precombat += /augmentation
//actions.precombat += /arcane_intellect
//actions.precombat += /snapshot_stats
//actions.precombat += /blizzard,if=active_enemies>=2&talent.ice_caller&!talent.fractured_frost|active_enemies>=3
//actions.precombat += /frostbolt,if=active_enemies<=2

class AlwaysSucceed extends bt.Composite {
  constructor() {
    super();
  }

  tick() {
    return bt.Status.Success;
  }
}

// TODO: need a way to detect previous spell used (prev_gcd) to fully implement the action lists
// TODO: add ice lances when any target is frozen
export class NuclearFrostMageBehavior extends Behavior {
  name = "Nuclear Frost";
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Frost;

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          //# Executed every time the actor is available.
          //actions = counterspell
          spell.interrupt("Counterspell"),

          //actions += /call_action_list,name=cds
          //this.cds(),

          this.iceBarrier(),

          //actions += /run_action_list,name=aoe,if=active_enemies>=7|active_enemies>=3&talent.ice_caller
          new bt.Decorator(
            req => this.enemiesAroundTarget(20) >= 7 || this.enemiesAroundTarget(20) >= 3 && me.hasAura("Ice Caller"),
            this.aoe(),
            new AlwaysSucceed(),
          ),

          //actions += /run_action_list,name=ss_cleave,if=active_enemies>=2&active_enemies<=3&talent.splinterstorm
          new bt.Decorator(
            req => this.enemiesAroundTarget(20) >= 2 && this.enemiesAroundTarget(20) <= 3 && me.hasAura("Splinterstorm"),
            this.ss_cleave(),
            new AlwaysSucceed(),
          ),

          //actions += /run_action_list,name=cleave,if=active_enemies>=2&active_enemies<=3
          new bt.Decorator(
            req => this.enemiesAroundTarget(20) >= 2 && this.enemiesAroundTarget(20) <= 3,
            this.cleave(),
            new AlwaysSucceed(),
          ),

          //actions += /run_action_list,name=ss_st,if=talent.splinterstorm
          new bt.Decorator(
            req => me.hasAura("Splinterstorm"),
            this.ss_st(),
            new AlwaysSucceed(),
          ),

          //actions += /run_action_list,name=st
          this.st(),
        )
      )
    );
  }

  cds() {
    return new bt.Selector(
      //actions.cds = use_item, name = imperfect_ascendancy_serum,if= buff.icy_veins.remains > 19 | fight_remains < 25
      //actions.cds += /use_item,name=spymasters_web,if=(buff.icy_veins.remains>19&(fight_remains<100|buff.spymasters_report.stack=40&fight_remains>120))|fight_remains<25
      //actions.cds += /potion,if=prev_off_gcd.icy_veins|fight_remains<60
      //actions.cds += /use_item,name=dreambinder_loom_of_the_great_cycle,if=(equipped.nymues_unraveling_spindle&prev_gcd.1.nymues_unraveling_spindle)|fight_remains>2
      //actions.cds += /use_item,name=belorrelos_the_suncaller,if=time>5&!prev_gcd.1.flurry
      //actions.cds += /flurry,if=time=0&active_enemies<=2
      //actions.cds += /icy_veins
      //actions.cds += /use_items
      //actions.cds += /invoke_external_buff,name=power_infusion,if=buff.power_infusion.down
      //actions.cds += /invoke_external_buff,name=blessing_of_summer,if=buff.blessing_of_summer.down
      //actions.cds += /blood_fury
      //actions.cds += /berserking
      //actions.cds += /lights_judgment
      //actions.cds += /fireblood
      //actions.cds += /ancestral_call
    );
  }

  aoe() {
    return new bt.Selector(
      //actions.aoe = cone_of_cold,if= talent.coldest_snap & (prev_gcd.1.comet_storm | prev_gcd.1.frozen_orb & !talent.comet_storm)
      spell.cast("Cone of Cold", this.getCurrentTarget, req => this.enemiesForConeOfCold() && me.hasAura("Coldest Snap") && !me.hasAura("Comet Storm")),
      //actions.aoe += /frozen_orb,if=(!prev_gcd.1.cone_of_cold|!talent.isothermic_core)&(!prev_gcd.1.glacial_spike|!freezable)
      spell.cast("Frozen Orb", this.getCurrentTarget, req => this.facingForFrozenOrb()),
      //actions.aoe += /blizzard,if=!prev_gcd.1.glacial_spike|!freezable
      spell.cast("Blizzard", this.getCurrentTarget),
      //actions.aoe += /frostbolt,if=buff.icy_veins.up&(buff.deaths_chill.stack<9|buff.deaths_chill.stack=9&!action.frostbolt.in_flight)&buff.icy_veins.remains>8&talent.deaths_chill
      spell.cast("Frostbolt", this.getCurrentTarget, req => me.hasAuraByMe("Icy Veins") && me.getAuraStacks("Death's Chill") < 9 && me.getAura("Icy Veins")?.remaining > 8000 && me.hasAura("Death's Chill")),
      //actions.aoe += /comet_storm,if=!prev_gcd.1.glacial_spike&(!talent.coldest_snap|cooldown.cone_of_cold.ready&cooldown.frozen_orb.remains>25|(cooldown.cone_of_cold.remains>10&talent.frostfire_bolt|cooldown.cone_of_cold.remains>20&!talent.frostfire_bolt))
      spell.cast("Comet Storm", this.getCurrentTarget, req => (!me.hasAura("Coldest Snap") || spell.getCooldown("Cone of Cold").ready && spell.getCooldown("Frozen Orb").timeleft > 25000 || (spell.getCooldown("Cone of Cold").timeleft > 10000 && me.hasAura("Frostfire Bolt") || spell.getCooldown("Cone of Cold").timeleft > 20000 && !me.hasAura("Frostfire Bolt")))),
      //actions.aoe += /freeze,if=freezable&debuff.frozen.down&(!talent.glacial_spike|prev_gcd.1.glacial_spike)
      //spell.cast("Freeze", this.getCurrentTarget/** req => debuff.frozen.down*/),
      //actions.aoe += /ice_nova,if=freezable&!prev_off_gcd.freeze&(prev_gcd.1.glacial_spike)
      spell.cast("Ice Nova", this.getCurrentTarget),
      //actions.aoe += /frost_nova,if=freezable&!prev_off_gcd.freeze&(prev_gcd.1.glacial_spike&!remaining_winters_chill)

      //actions.aoe += /shifting_power,if=cooldown.comet_storm.remains>10
      spell.cast("Shifting Power", on => me, req => spell.getCooldown("Comet Storm").timeleft > 10000),
      //actions.aoe += /frostbolt,if=buff.frostfire_empowerment.react&!buff.excess_frost.react&!buff.excess_fire.react
      spell.cast("Frostbolt", this.getCurrentTarget, req => me.hasAuraByMe("Frostfire Empowerment") && !me.hasAuraByMe("Excess Frost") && !me.hasAuraByMe("Excess Fire")),
      //actions.aoe += /flurry,if=cooldown_react&!remaining_winters_chill&(buff.brain_freeze.react&!talent.excess_frost|buff.excess_frost.react)
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() > 0 && (me.hasAuraByMe("Brain Freeze") && !me.hasAura("Excess Frost") || me.hasAuraByMe("Excess Frost"))),
      //actions.aoe += /ice_lance,if=buff.fingers_of_frost.react|debuff.frozen.remains>travel_time|remaining_winters_chill
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAuraByMe("Fingers of Frost") /** || debuff.frozen.remains */ || this.remainingWintersChill() > 0),
      //actions.aoe += /flurry,if=cooldown_react&!remaining_winters_chill
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() === 0),
      //actions.aoe += /ice_nova,if=active_enemies>=4&(!talent.glacial_spike|!freezable)&!talent.frostfire_bolt
      spell.cast("Ice Nova", this.getCurrentTarget, req => this.enemiesAroundMe(20) >= 4 && (!me.hasAura("Glacial Spike")) && !me.hasAura("Frostfire Bolt")),
      //actions.aoe += /cone_of_cold,if=!talent.coldest_snap&active_enemies>=7
      spell.cast("Cone of Cold", this.getCurrentTarget, req => !me.hasAura("Coldest Snap") && this.enemiesInFrontOfMe() >= 7),
      //actions.aoe += /frostbolt
      spell.cast("Frostbolt", this.getCurrentTarget),
      //actions.aoe += /call_action_list,name=movement
      this.movement(),
    );
  }

  cleave() {
    return new bt.Selector(
      //actions.cleave = comet_storm,if= prev_gcd.1.flurry | prev_gcd.1.cone_of_cold
      spell.cast("Comet Storm", this.getCurrentTarget),
      //actions.cleave += /flurry,target_if=min:debuff.winters_chill.stack,if=cooldown_react&(((prev_gcd.1.frostbolt|prev_gcd.1.frostfire_bolt)&buff.icicles.react>=3)|prev_gcd.1.glacial_spike|(buff.icicles.react>=3&buff.icicles.react<5&charges_fractional=2))
      spell.cast("Flurry", this.getCurrentTarget, req => me.getAuraStacks("Icicles") >= 3 && me.getAuraStacks("Icicles") < 5),
      //actions.cleave += /ice_lance,target_if=max:debuff.winters_chill.stack,if=talent.glacial_spike&debuff.winters_chill.down&buff.icicles.react=4&buff.fingers_of_frost.react
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAura("Glacial Spike") && this.remainingWintersChill() === 0 && me.getAuraStacks("Icicles") === 4 && me.hasAuraByMe("Fingers of Frost")),
      //actions.cleave += /ray_of_frost,target_if=max:debuff.winters_chill.stack,if=remaining_winters_chill=1
      spell.cast("Ray of Frost", this.getCurrentTarget, req => this.remainingWintersChill() === 1),
      //actions.cleave += /glacial_spike,if=buff.icicles.react=5&(action.flurry.cooldown_react|remaining_winters_chill)
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") === 5 && this.remainingWintersChill() > 0),
      //actions.cleave += /frozen_orb,if=buff.fingers_of_frost.react<2&(!talent.ray_of_frost|cooldown.ray_of_frost.remains)
      spell.cast("Frozen Orb", this.getCurrentTarget, req => me.hasAuraByMe("Fingers of Frost") && me.getAuraByMe("Fingers of Frost").remaining < 2000 && (!me.hasAura("Ray of Frost") || spell.getCooldown("Ray of Frost").timeleft > 0)),
      //actions.cleave += /cone_of_cold,if=talent.coldest_snap&cooldown.comet_storm.remains>10&cooldown.frozen_orb.remains>10&remaining_winters_chill=0&active_enemies>=3
      spell.cast("Cone of Cold", this.getCurrentTarget, req => this.enemiesForConeOfCold() && me.hasAura("Coldest Snap") && spell.getCooldown("Comet Storm").timeleft > 10000 && spell.getCooldown("Frozen Orb").timeleft > 10000 && this.remainingWintersChill() === 0),
      //actions.cleave += /shifting_power,if=cooldown.frozen_orb.remains>10&(!talent.comet_storm|cooldown.comet_storm.remains>10)&(!talent.ray_of_frost|cooldown.ray_of_frost.remains>10)|cooldown.icy_veins.remains<20
      spell.cast("Shifting Power", on => me, req => spell.getCooldown("Frozen Orb").timeleft > 10000 && (!me.hasAura("Comet Storm") || spell.getCooldown("Comet Storm").timeleft > 10000) && (!me.hasAura("Ray of Frost") || spell.getCooldown("Ray of Frost").timeleft > 10000) || spell.getCooldown("Icy Veins").timeleft < 20000),
      //actions.cleave += /glacial_spike,if=buff.icicles.react=5
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") === 5),
      //actions.cleave += /ice_lance,target_if=max:debuff.winters_chill.stack,if=buff.fingers_of_frost.react&!prev_gcd.1.glacial_spike|remaining_winters_chill
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAuraByMe("Fingers of Frost") && this.remainingWintersChill() > 0),
      //actions.cleave += /ice_nova,if=active_enemies>=4
      spell.cast("Ice Nova", this.getCurrentTarget),
      //actions.cleave += /frostbolt
      spell.cast("Frostbolt", this.getCurrentTarget),
      //actions.aoe += /call_action_list,name=movement
      this.movement(),
    );
  }

  ss_cleave() {
    return new bt.Selector(
      //actions.ss_cleave = flurry, target_if = min: debuff.winters_chill.stack,if= cooldown_react & remaining_winters_chill= 0 & debuff.winters_chill.down & (prev_gcd.1.frostbolt | prev_gcd.1.glacial_spike)
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() === 0),
      //actions.ss_cleave += /ice_lance,target_if=max:debuff.winters_chill.stack,if=buff.icy_veins.up&debuff.winters_chill.stack=2
      spell.cast("Ice Lance", this.getCurrentTarget, req => this.remainingWintersChill() > 0 && me.hasAuraByMe("Icy Veins")),
      //actions.ss_cleave += /ray_of_frost,if=buff.icy_veins.down&buff.freezing_winds.down&remaining_winters_chill=1
      spell.cast("Ray of Frost", this.getCurrentTarget, req => !me.hasAuraByMe("Icy Veins") && this.remainingWintersChill() === 1),
      //actions.ss_cleave += /frozen_orb
      spell.cast("Frozen Orb", this.getCurrentTarget, req => this.facingForFrozenOrb()),
      //actions.ss_cleave += /shifting_power
      spell.cast("Shifting Power", on => me),
      //actions.ss_cleave += /ice_lance,target_if=max:debuff.winters_chill.stack,if=remaining_winters_chill|buff.fingers_of_frost.react
      spell.cast("Ice Lance", this.getCurrentTarget, req => this.remainingWintersChill() > 0 && me.hasAuraByMe("Fingers of Frost")),
      //actions.ss_cleave += /comet_storm,if=prev_gcd.1.flurry|prev_gcd.1.cone_of_cold|action.splinterstorm.in_flight
      spell.cast("Comet Storm", this.getCurrentTarget),
      //actions.ss_cleave += /glacial_spike,if=buff.icicles.react=5
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") === 5),
      //actions.ss_cleave += /flurry,target_if=min:debuff.winters_chill.stack,if=cooldown_react&buff.icy_veins.up
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() > 0 && me.hasAuraByMe("Icy Veins")),
      //actions.ss_cleave += /frostbolt
      spell.cast("Frostbolt", this.getCurrentTarget),
      //actions.aoe += /call_action_list,name=movement
      this.movement(),
    );
  }

  ss_st() {
    return new bt.Selector(
      //actions.ss_st = flurry,if= cooldown_react & remaining_winters_chill= 0 & debuff.winters_chill.down & (prev_gcd.1.frostbolt | prev_gcd.1.glacial_spike)
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() === 0),
      //actions.ss_st += /ice_lance,if=buff.icy_veins.up&(debuff.winters_chill.stack=2|debuff.winters_chill.stack=1&action.splinterstorm.in_flight)
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAuraByMe("Icy Veins") && this.remainingWintersChill() >= 1),
      //actions.ss_st += /ray_of_frost,if=buff.icy_veins.down&buff.freezing_winds.down&remaining_winters_chill=1
      spell.cast("Ray of Frost", this.getCurrentTarget, req => !me.hasAuraByMe("Icy Veins") && !me.hasAuraByMe("Freezing Winds") && this.remainingWintersChill() === 1),
      //actions.ss_st += /frozen_orb
      spell.cast("Frozen Orb", this.getCurrentTarget, req => this.facingForFrozenOrb()),
      //actions.ss_st += /shifting_power
      spell.cast("Shifting Power", on => me),
      //actions.ss_st += /ice_lance,if=remaining_winters_chill
      spell.cast("Ice Lance", this.getCurrentTarget, req => this.remainingWintersChill() > 0),
      //actions.ss_st += /comet_storm,if=prev_gcd.1.flurry|prev_gcd.1.cone_of_cold|action.splinterstorm.in_flight
      spell.cast("Comet Storm", this.getCurrentTarget),
      //actions.ss_st += /glacial_spike,if=buff.icicles.react=5
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") === 5),
      //actions.ss_st += /flurry,if=cooldown_react&buff.icy_veins.up&!action.splinterstorm.in_flight
      spell.cast("Flurry", this.getCurrentTarget, req => me.hasAuraByMe("Icy Veins")),
      //actions.ss_st += /ice_lance,if=buff.fingers_of_frost.react
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAuraByMe("Fingers of Frost")),
      //actions.ss_st += /frostbolt
      spell.cast("Frostbolt", this.getCurrentTarget),
      //actions.aoe += /call_action_list,name=movement
      this.movement(),
    );
  }

  st() {
    return new bt.Selector(
      //actions.st = comet_storm,if= prev_gcd.1.flurry | prev_gcd.1.cone_of_cold
      spell.cast("Comet Storm", this.getCurrentTarget),
      //actions.st += /flurry,if=cooldown_react&remaining_winters_chill=0&debuff.winters_chill.down&(((prev_gcd.1.frostbolt | prev_gcd.1.frostfire_bolt) & buff.icicles.react >= 3 | (prev_gcd.1.frostbolt | prev_gcd.1.frostfire_bolt) & buff.brain_freeze.react) | prev_gcd.1.glacial_spike | talent.glacial_spike & buff.icicles.react=4 & !buff.fingers_of_frost.react) | buff.excess_frost.up & buff.frostfire_empowerment.up
      spell.cast("Flurry", this.getCurrentTarget, req => this.remainingWintersChill() == 0 /** @todo fully implement logic for Flurry */),
      //actions.st += /ice_lance,if=talent.glacial_spike&debuff.winters_chill.down&buff.icicles.react=4&buff.fingers_of_frost.react
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAura("Glacial Spike") && this.getCurrentTarget()?.hasAuraByMe("Winter's Chill") && me.getAuraStacks("Icicles") === 4 && me.hasAuraByMe("Fingers of Frost")),
      //actions.st += /ray_of_frost,if=remaining_winters_chill=1
      spell.cast("Ray of Frost", this.getCurrentTarget, req => this.remainingWintersChill() == 1),
      //actions.st += /glacial_spike,if=buff.icicles.react=5&(action.flurry.cooldown_react|remaining_winters_chill)
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") === 5 && this.remainingWintersChill() > 0),
      //actions.st += /frozen_orb,if=buff.fingers_of_frost.react<2&(!talent.ray_of_frost|cooldown.ray_of_frost.remains)
      spell.cast("Frozen Orb", this.getCurrentTarget, req => this.facingForFrozenOrb() && me.getAuraStacks("Fingers of Frost") < 2 && (!me.hasAura("Ray of Frost") || !spell.getCooldown("Ray of Frost").ready)),
      //actions.st += /cone_of_cold,if=talent.coldest_snap&cooldown.comet_storm.remains>10&cooldown.frozen_orb.remains>10&remaining_winters_chill=0&active_enemies>=3
      spell.cast("Cone of Cold", on => me, req => me.hasAura("Coldest Snap") && spell.getCooldown("Comet Storm").timeleft > 10000 && spell.getCooldown("Frozen Orb") > 10000 && this.remainingWintersChill() == 0 && this.enemiesInFrontOfMe() >= 3),
      //actions.st += /blizzard,if=active_enemies>=2&talent.ice_caller&talent.freezing_rain&(!talent.splintering_cold&!talent.ray_of_frost|buff.freezing_rain.up|active_enemies>=3)
      spell.cast("Blizzard", this.getCurrentTarget, req => this.enemiesAroundTarget(20) >= 2 && me.hasAura("Ice Caller") && me.hasAura("Freezing Rain") && (!me.hasAura("Splintering Cold") && !me.hasAura("Ray of Frost") || me.hasAuraByMe("Freezing Rain") || this.enemiesAroundTarget(20) >= 3)),
      //actions.st += /shifting_power,if=(buff.icy_veins.down|!talent.deaths_chill)&cooldown.frozen_orb.remains>10&(!talent.comet_storm|cooldown.comet_storm.remains>10)&(!talent.ray_of_frost|cooldown.ray_of_frost.remains>10)|cooldown.icy_veins.remains<20
      spell.cast("Shifting Power", on => me, req =>
        (!me.hasAuraByMe("Icy Veins") && !me.hasAura("Death's Chill")) &&
        spell.getCooldown("Frozen Orb").timeleft > 10000 &&
        (!me.hasAura("Comet Storm") || spell.getCooldown("Comet Storm").timeleft > 10000) &&
        (!me.hasAura("Ray of Frost") || spell.getCooldown("Ray of Frost").timeleft > 10000) ||
        spell.getCooldown("Icy Veins").timeleft < 20000),
      //actions.st += /glacial_spike,if=buff.icicles.react=5
      spell.cast("Glacial Spike", this.getCurrentTarget, req => me.getAuraStacks("Icicles") == 5),
      //actions.st += /ice_lance,if=buff.fingers_of_frost.react&!prev_gcd.1.glacial_spike|remaining_winters_chill
      spell.cast("Ice Lance", this.getCurrentTarget, req => me.hasAuraByMe("Fingers of Frost")),
      //actions.st += /ice_nova,if=active_enemies>=4
      spell.cast("Ice Nova", this.getCurrentTarget, req => this.enemiesAroundTarget(8) >= 4),
      //actions.st += /frostbolt
      spell.cast("Frostbolt", this.getCurrentTarget),
      //actions.aoe += /call_action_list,name=movement
      this.movement(),
    );
  }

  movement() {
    return new bt.Decorator(
      req => me.isMoving(),
      new bt.Selector(
        //actions.movement = any_blink,if= movement.distance > 10

        //actions.movement += /ice_floes,if=buff.ice_floes.down
        spell.cast("Ice Floes", on => me, req => !me.hasAuraByMe("Ice Floes")),
        //actions.movement += /ice_nova
        spell.cast("Ice Nova", on => me, this.getCurrentTarget),
        //actions.movement += /cone_of_cold,if=!talent.coldest_snap&active_enemies>=2
        spell.cast("Cone of Cold", req => !me.hasAura("Coldest Snap") && this.enemiesInFrontOfMe() >= 2),
        //actions.movement += /arcane_explosion,if=mana.pct>30&active_enemies>=2
        spell.cast("Arcane Explosion", req => me.pctPower > 30 && this.enemiesAroundMe(8) >= 2),
        //actions.movement += /fire_blast
        spell.cast("Fire Blast", this.getCurrentTarget),
        //actions.movement += /ice_lance
        spell.cast("Ice Lance", this.getCurrentTarget),
      ),
    );
  }

  iceBarrier() {
    return new bt.Decorator(
      req => me.totalAbsorb === 0,
      spell.cast("Ice Barrier", on => me),
    );
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.distanceTo2D(unit) <= 40 && me.isFacing(unit) && (unit.inCombatWithMe || wow.Party.currentParty?.isUnitInCombatWithParty(unit));
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }

  enemiesAroundMe(range) {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= range);
    return targets?.length;
  }

  enemiesInFrontOfMe() {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= 8 && me.isFacing(unit, 60));
    return targets?.length;
  }

  remainingWintersChill() {
    const target = this.getCurrentTarget();
    return target?.getAuraStacks("Winter's Chill");
  }

  facingForFrozenOrb() {
    const target = this.getCurrentTarget();
    return target ? me.isFacing(target, 8) : false;
  }

  enemiesForConeOfCold() {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= 8 && me.isFacing(unit, 25));
    return targets?.length >= 3;
  }
}
