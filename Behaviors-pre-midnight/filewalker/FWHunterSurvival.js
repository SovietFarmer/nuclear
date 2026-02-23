import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Pet from "@/Core/Pet";

/**
 * Behavior implementation for Survival Hunter
 * Follows the SimC APL strictly
 */
export class HunterSurvivalSimCBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.Survival;
  name = "FW Hunter Survival";
  version = 1;

  /**
   * Builds the behavior tree for Survival Hunter
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.summonPet(),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      // Call the action lists in the same order as the APL
      new bt.Sequence(
        Common.ensureAutoAttack(),
        this.callActionList_cds(),
        this.callActionList_trinkets(),
        // Call the appropriate action list based on talents and number of enemies
        new bt.Selector(
          new bt.Decorator(
            () => this.activeEnemies() < 3 && this.hasPackLeader(),
            this.callActionList_plst()
          ),
          new bt.Decorator(
            () => this.activeEnemies() >= 3 && this.hasPackLeader(),
            this.callActionList_plcleave()
          ),
          new bt.Decorator(
            () => this.activeEnemies() < 3 && !this.hasPackLeader(),
            this.callActionList_sentst()
          ),
          new bt.Decorator(
            () => this.activeEnemies() >= 3 && !this.hasPackLeader(),
            this.callActionList_sentcleave()
          )
        ),
        // Fallback racial abilities
        Spell.cast("Arcane Torrent"),
        Spell.cast("Bag of Tricks"),
        Spell.cast("Light's Judgment")
      )
    );
  }

  /**
   * Pet summoning logic
   */
  summonPet() {
    return new bt.Selector(
      Pet.attack(() => this.getCurrentTarget()),
      new bt.Action(() => {
        if (!Pet.isAlive() && !me.isCasting && !me.isChanneling) {
          // Check for the default pet spell
          const petSpell = Spell.getSpell("Call Pet 1");
          if (petSpell && petSpell.isKnown && petSpell.cooldown.ready) {
            if (petSpell.cast()) {
              console.info("Summoning pet");
              return bt.Status.Success;
            }
          }
        }
        return bt.Status.Failure;
      })
    );
  }

  /**
   * Cooldowns action list
   */
  callActionList_cds() {
    return new bt.Selector(
      // actions.cds=blood_fury,if=buff.coordinated_assault.up|!talent.coordinated_assault&cooldown.spearhead.remains|!talent.spearhead&!talent.coordinated_assault
      Spell.cast("Blood Fury", () => me.hasAura("Coordinated Assault") || 
        (!this.hasTalent("Coordinated Assault") && Spell.getCooldown("Spearhead").timeleft > 0) || 
        (!this.hasTalent("Spearhead") && !this.hasTalent("Coordinated Assault"))),
      
      // Power Infusion is an external buff, so we skip it
      
      // actions.cds+=/harpoon,if=prev.kill_command
      Spell.cast("Harpoon", () => Spell.getLastSuccessfulSpell() === "Kill Command"),
      
      // actions.cds+=/ancestral_call,if=buff.coordinated_assault.up|!talent.coordinated_assault&cooldown.spearhead.remains|!talent.spearhead&!talent.coordinated_assault
      Spell.cast("Ancestral Call", () => me.hasAura("Coordinated Assault") || 
        (!this.hasTalent("Coordinated Assault") && Spell.getCooldown("Spearhead").timeleft > 0) || 
        (!this.hasTalent("Spearhead") && !this.hasTalent("Coordinated Assault"))),
      
      // actions.cds+=/fireblood,if=buff.coordinated_assault.up|!talent.coordinated_assault&cooldown.spearhead.remains|!talent.spearhead&!talent.coordinated_assault
      Spell.cast("Fireblood", () => me.hasAura("Coordinated Assault") || 
        (!this.hasTalent("Coordinated Assault") && Spell.getCooldown("Spearhead").timeleft > 0) || 
        (!this.hasTalent("Spearhead") && !this.hasTalent("Coordinated Assault"))),
      
      // actions.cds+=/berserking,if=buff.coordinated_assault.up|!talent.coordinated_assault&cooldown.spearhead.remains|!talent.spearhead&!talent.coordinated_assault|time_to_die<13
      Spell.cast("Berserking", () => me.hasAura("Coordinated Assault") || 
        (!this.hasTalent("Coordinated Assault") && Spell.getCooldown("Spearhead").timeleft > 0) || 
        (!this.hasTalent("Spearhead") && !this.hasTalent("Coordinated Assault")) ||
        this.getTimeToDie() < 13),
      
      // actions.cds+=/muzzle
      Spell.cast("Muzzle"),
      
      // Potion usage skipped as it's not part of the in-game rotation
      
      // actions.cds+=/aspect_of_the_eagle,if=target.distance>=6
      Spell.cast("Aspect of the Eagle", () => this.getCurrentTarget().distanceTo(me) >= 6)
    );
  }

  /**
   * Trinket usage logic
   */
  callActionList_trinkets() {
    // We won't implement the specific trinket logic as requested
    return new bt.Action(() => bt.Status.Failure);
  }

  /**
   * Pack Leader Single Target action list
   */
  callActionList_plst() {
    return new bt.Selector(
      // actions.plst=kill_command,target_if=min:bloodseeker.remains,if=(buff.relentless_primal_ferocity.up&buff.tip_of_the_spear.stack<1)|howl_summon_ready&time_to_die<20
      Spell.cast("Kill Command", () => 
        (me.hasAura("Relentless Primal Ferocity") && this.getTipOfTheSpearStacks() < 1) ||
        (this.howlSummonReady() && this.getTimeToDie() < 20)),
      
      // actions.plst+=/explosive_shot,if=cooldown.coordinated_assault.remains&cooldown.coordinated_assault.remains<gcd
      Spell.cast("Explosive Shot", () => 
        Spell.getCooldown("Coordinated Assault").timeleft > 0 &&
        Spell.getCooldown("Coordinated Assault").timeleft < 1.5),
      
      // actions.plst+=/spearhead,if=cooldown.coordinated_assault.remains
      Spell.cast("Spearhead", () => Spell.getCooldown("Coordinated Assault").timeleft > 0),
      
      // actions.plst+=/raptor_bite,target_if=min:dot.serpent_sting.remains,if=!dot.serpent_sting.ticking&target.time_to_die>12&(!talent.contagious_reagents|active_dot.serpent_sting=0)
      Spell.cast("Raptor Strike", () => 
        !this.getCurrentTarget().hasAura("Serpent Sting") && 
        this.getTimeToDie() > 12 && 
        (!this.hasTalent("Contagious Reagents") || this.getActiveDotsCount("Serpent Sting") === 0)),
      
      // actions.plst+=/raptor_bite,target_if=max:dot.serpent_sting.remains,if=talent.contagious_reagents&active_dot.serpent_sting<active_enemies&dot.serpent_sting.remains
      Spell.cast("Raptor Strike", () => 
        this.hasTalent("Contagious Reagents") && 
        this.getActiveDotsCount("Serpent Sting") < this.activeEnemies() && 
        this.getCurrentTarget().hasAura("Serpent Sting")),
      
      // actions.plst+=/butchery
      Spell.cast("Butchery"),
      
      // actions.plst+=/kill_command,if=buff.strike_it_rich.remains&buff.tip_of_the_spear.stack<1
      Spell.cast("Kill Command", () => 
        me.hasAura("Strike It Rich") && this.getTipOfTheSpearStacks() < 1),
      
      // actions.plst+=/raptor_bite,if=buff.strike_it_rich.remains&buff.tip_of_the_spear.stack>0
      Spell.cast("Raptor Strike", () => 
        me.hasAura("Strike It Rich") && this.getTipOfTheSpearStacks() > 0),
      
      // actions.plst+=/flanking_strike,if=buff.tip_of_the_spear.stack=1|buff.tip_of_the_spear.stack=2
      Spell.cast("Flanking Strike", () => 
        this.getTipOfTheSpearStacks() === 1 || this.getTipOfTheSpearStacks() === 2),
      
      // actions.plst+=/fury_of_the_eagle,if=buff.tip_of_the_spear.stack>0&(!raid_event.adds.exists|raid_event.adds.exists&raid_event.adds.in>40)
      Spell.cast("Fury of the Eagle", () => 
        this.getTipOfTheSpearStacks() > 0),
      
      // actions.plst+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0&cooldown.wildfire_bomb.charges_fractional>1.4|cooldown.wildfire_bomb.charges_fractional>1.9|cooldown.coordinated_assault.remains<2*gcd&talent.bombardier|howl_summon_ready
      Spell.cast("Wildfire Bomb", () => 
        (this.getTipOfTheSpearStacks() > 0 && Spell.getChargesFractional("Wildfire Bomb") > 1.4) || 
        Spell.getChargesFractional("Wildfire Bomb") > 1.9 || 
        (Spell.getCooldown("Coordinated Assault").timeleft < 2 * 1.5 && this.hasTalent("Bombardier")) || 
        this.howlSummonReady()),
      
      // actions.plst+=/explosive_shot,if=cooldown.coordinated_assault.remains<gcd
      Spell.cast("Explosive Shot", () => 
        Spell.getCooldown("Coordinated Assault").timeleft < 1.5),
      
      // actions.plst+=/coordinated_assault,if=!talent.bombardier|talent.bombardier&cooldown.wildfire_bomb.charges_fractional<1
      Spell.cast("Coordinated Assault", () => 
        !this.hasTalent("Bombardier") || 
        (this.hasTalent("Bombardier") && Spell.getChargesFractional("Wildfire Bomb") < 1)),
      
      // actions.plst+=/kill_command,target_if=min:bloodseeker.remains,if=focus+cast_regen<focus.max&(!buff.relentless_primal_ferocity.up|(buff.relentless_primal_ferocity.up&buff.tip_of_the_spear.stack<1|focus<30))
      Spell.cast("Kill Command", () => 
        me.powerByType(PowerType.Focus) + 15 < 120 && 
        (!me.hasAura("Relentless Primal Ferocity") || 
         (me.hasAura("Relentless Primal Ferocity") && 
          (this.getTipOfTheSpearStacks() < 1 || me.powerByType(PowerType.Focus) < 30)))),
      
      // actions.plst+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0&(!raid_event.adds.exists|raid_event.adds.exists&raid_event.adds.in>15)
      Spell.cast("Wildfire Bomb", () => 
        this.getTipOfTheSpearStacks() > 0),
      
      // actions.plst+=/raptor_bite,target_if=min:dot.serpent_sting.remains,if=!talent.contagious_reagents
      Spell.cast("Raptor Strike", () => 
        !this.hasTalent("Contagious Reagents")),
      
      // actions.plst+=/raptor_bite,target_if=max:dot.serpent_sting.remains
      Spell.cast("Raptor Strike"),
      
      // actions.plst+=/kill_shot
      Spell.cast("Kill Shot"),
      
      // actions.plst+=/explosive_shot
      Spell.cast("Explosive Shot")
    );
  }

  /**
   * Pack Leader AOE/Cleave action list
   */
  callActionList_plcleave() {
    return new bt.Selector(
      // actions.plcleave=spearhead,if=cooldown.coordinated_assault.remains
      Spell.cast("Spearhead", () => Spell.getCooldown("Coordinated Assault").timeleft > 0),
      
      // actions.plcleave+=/raptor_bite,target_if=max:dot.serpent_sting.remains,if=buff.strike_it_rich.up&buff.strike_it_rich.remains<gcd|buff.hogstrider.remains
      Spell.cast("Raptor Strike", () => 
        (me.hasAura("Strike It Rich") && this.getAuraRemainingTime("Strike It Rich") < 1.5) ||
        me.hasAura("Hogstrider")),
      
      // actions.plcleave+=/kill_command,target_if=min:bloodseeker.remains,if=buff.relentless_primal_ferocity.up&buff.tip_of_the_spear.stack<1
      Spell.cast("Kill Command", () => 
        me.hasAura("Relentless Primal Ferocity") && this.getTipOfTheSpearStacks() < 1),
      
      // actions.plcleave+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0&cooldown.wildfire_bomb.charges_fractional>1.7|cooldown.wildfire_bomb.charges_fractional>1.9|cooldown.coordinated_assault.remains<2*gcd|talent.butchery&cooldown.butchery.remains<gcd|howl_summon_ready
      Spell.cast("Wildfire Bomb", () => 
        (this.getTipOfTheSpearStacks() > 0 && Spell.getChargesFractional("Wildfire Bomb") > 1.7) || 
        Spell.getChargesFractional("Wildfire Bomb") > 1.9 || 
        Spell.getCooldown("Coordinated Assault").timeleft < 2 * 1.5 || 
        (this.hasTalent("Butchery") && Spell.getCooldown("Butchery").timeleft < 1.5) || 
        this.howlSummonReady()),
      
      // actions.plcleave+=/flanking_strike,if=buff.tip_of_the_spear.stack=2|buff.tip_of_the_spear.stack=1
      Spell.cast("Flanking Strike", () => 
        this.getTipOfTheSpearStacks() === 2 || this.getTipOfTheSpearStacks() === 1),
      
      // actions.plcleave+=/butchery
      Spell.cast("Butchery"),
      
      // actions.plcleave+=/coordinated_assault,if=!talent.bombardier|talent.bombardier&cooldown.wildfire_bomb.charges_fractional<1
      Spell.cast("Coordinated Assault", () => 
        !this.hasTalent("Bombardier") || 
        (this.hasTalent("Bombardier") && Spell.getChargesFractional("Wildfire Bomb") < 1)),
      
      // actions.plcleave+=/fury_of_the_eagle,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Fury of the Eagle", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.plcleave+=/kill_command,target_if=min:bloodseeker.remains,if=focus+cast_regen<focus.max
      Spell.cast("Kill Command", () => me.powerByType(PowerType.Focus) + 15 < 120),
      
      // actions.plcleave+=/explosive_shot
      Spell.cast("Explosive Shot"),
      
      // actions.plcleave+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Wildfire Bomb", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.plcleave+=/kill_shot,if=buff.deathblow.remains&talent.sic_em
      Spell.cast("Kill Shot", () => 
        me.hasAura("Deathblow") && this.hasTalent("Sic 'Em")),
      
      // actions.plcleave+=/raptor_bite
      Spell.cast("Raptor Strike")
    );
  }

  /**
   * Sentinel Single Target action list
   */
  callActionList_sentst() {
    return new bt.Selector(
      // actions.sentst=wildfire_bomb,if=!buff.lunar_storm_cooldown.remains
      Spell.cast("Wildfire Bomb", () => !me.hasAura("Lunar Storm Cooldown")),
      
      // actions.sentst+=/kill_command,target_if=min:bloodseeker.remains,if=(buff.relentless_primal_ferocity.up&buff.tip_of_the_spear.stack<1)
      Spell.cast("Kill Command", () => 
        me.hasAura("Relentless Primal Ferocity") && this.getTipOfTheSpearStacks() < 1),
      
      // actions.sentst+=/spearhead,if=cooldown.coordinated_assault.remains
      Spell.cast("Spearhead", () => Spell.getCooldown("Coordinated Assault").timeleft > 0),
      
      // actions.sentst+=/flanking_strike,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Flanking Strike", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.sentst+=/kill_command,if=buff.strike_it_rich.remains&buff.tip_of_the_spear.stack<1
      Spell.cast("Kill Command", () => 
        me.hasAura("Strike It Rich") && this.getTipOfTheSpearStacks() < 1),
      
      // actions.sentst+=/mongoose_bite,if=buff.strike_it_rich.remains&buff.coordinated_assault.up
      Spell.cast("Mongoose Bite", () => 
        me.hasAura("Strike It Rich") && me.hasAura("Coordinated Assault")),
      
      // actions.sentst+=/wildfire_bomb,if=(buff.lunar_storm_cooldown.remains>full_recharge_time-gcd)&(buff.tip_of_the_spear.stack>0&cooldown.wildfire_bomb.charges_fractional>1.7|cooldown.wildfire_bomb.charges_fractional>1.9)|(talent.bombardier&cooldown.coordinated_assault.remains<2*gcd)
      Spell.cast("Wildfire Bomb", () => 
        (this.getAuraRemainingTime("Lunar Storm Cooldown") > Spell.getFullRechargeTime("Wildfire Bomb") - 1.5) && 
        ((this.getTipOfTheSpearStacks() > 0 && Spell.getChargesFractional("Wildfire Bomb") > 1.7) || 
         Spell.getChargesFractional("Wildfire Bomb") > 1.9) || 
        (this.hasTalent("Bombardier") && Spell.getCooldown("Coordinated Assault").timeleft < 2 * 1.5)),
      
      // actions.sentst+=/butchery
      Spell.cast("Butchery"),
      
      // actions.sentst+=/coordinated_assault,if=!talent.bombardier|talent.bombardier&cooldown.wildfire_bomb.charges_fractional<1
      Spell.cast("Coordinated Assault", () => 
        !this.hasTalent("Bombardier") || 
        (this.hasTalent("Bombardier") && Spell.getChargesFractional("Wildfire Bomb") < 1)),
      
      // actions.sentst+=/fury_of_the_eagle,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Fury of the Eagle", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.sentst+=/kill_command,target_if=min:bloodseeker.remains,if=buff.tip_of_the_spear.stack<1&cooldown.flanking_strike.remains<gcd
      Spell.cast("Kill Command", () => 
        this.getTipOfTheSpearStacks() < 1 && Spell.getCooldown("Flanking Strike").timeleft < 1.5),
      
      // actions.sentst+=/kill_command,target_if=min:bloodseeker.remains,if=focus+cast_regen<focus.max&(!buff.relentless_primal_ferocity.up|(buff.relentless_primal_ferocity.up&(buff.tip_of_the_spear.stack<2|focus<30)))
      Spell.cast("Kill Command", () => 
        me.powerByType(PowerType.Focus) + 15 < 120 && 
        (!me.hasAura("Relentless Primal Ferocity") || 
         (me.hasAura("Relentless Primal Ferocity") && 
          (this.getTipOfTheSpearStacks() < 2 || me.powerByType(PowerType.Focus) < 30)))),
      
      // actions.sentst+=/mongoose_bite,if=buff.mongoose_fury.remains<gcd&buff.mongoose_fury.stack>0
      Spell.cast("Mongoose Bite", () => 
        this.getAuraRemainingTime("Mongoose Fury") < 1.5 && 
        this.getAuraStacks("Mongoose Fury") > 0),
      
      // actions.sentst+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0&buff.lunar_storm_cooldown.remains>full_recharge_time&(!raid_event.adds.exists|raid_event.adds.exists&raid_event.adds.in>15)
      Spell.cast("Wildfire Bomb", () => 
        this.getTipOfTheSpearStacks() > 0 && 
        this.getAuraRemainingTime("Lunar Storm Cooldown") > Spell.getFullRechargeTime("Wildfire Bomb")),
      
      // actions.sentst+=/mongoose_bite,if=buff.mongoose_fury.remains
      Spell.cast("Mongoose Bite", () => this.getAuraRemainingTime("Mongoose Fury") > 0),
      
      // actions.sentst+=/explosive_shot
      Spell.cast("Explosive Shot"),
      
      // actions.sentst+=/kill_shot
      Spell.cast("Kill Shot"),
      
      // actions.sentst+=/raptor_bite,target_if=min:dot.serpent_sting.remains,if=!talent.contagious_reagents
      Spell.cast("Raptor Strike", () => !this.hasTalent("Contagious Reagents")),
      
      // actions.sentst+=/raptor_bite,target_if=max:dot.serpent_sting.remains
      Spell.cast("Raptor Strike")
    );
  }

  /**
   * Sentinel AOE/Cleave action list
   */
  callActionList_sentcleave() {
    return new bt.Selector(
      // actions.sentcleave=wildfire_bomb,if=!buff.lunar_storm_cooldown.remains
      Spell.cast("Wildfire Bomb", () => !me.hasAura("Lunar Storm Cooldown")),
      
      // actions.sentcleave+=/kill_command,target_if=min:bloodseeker.remains,if=buff.relentless_primal_ferocity.up&buff.tip_of_the_spear.stack<1
      Spell.cast("Kill Command", () => 
        me.hasAura("Relentless Primal Ferocity") && this.getTipOfTheSpearStacks() < 1),
      
      // actions.sentcleave+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0&cooldown.wildfire_bomb.charges_fractional>1.7|cooldown.wildfire_bomb.charges_fractional>1.9|(talent.bombardier&cooldown.coordinated_assault.remains<2*gcd)|talent.butchery&cooldown.butchery.remains<gcd
      Spell.cast("Wildfire Bomb", () => 
        (this.getTipOfTheSpearStacks() > 0 && Spell.getChargesFractional("Wildfire Bomb") > 1.7) || 
        Spell.getChargesFractional("Wildfire Bomb") > 1.9 || 
        (this.hasTalent("Bombardier") && Spell.getCooldown("Coordinated Assault").timeleft < 2 * 1.5) ||
        (this.hasTalent("Butchery") && Spell.getCooldown("Butchery").timeleft < 1.5)),
      
      // actions.sentcleave+=/raptor_bite,target_if=max:dot.serpent_sting.remains,if=buff.strike_it_rich.up&buff.strike_it_rich.remains<gcd
      Spell.cast("Raptor Strike", () => 
        me.hasAura("Strike It Rich") && this.getAuraRemainingTime("Strike It Rich") < 1.5),
      
      // actions.sentcleave+=/butchery
      Spell.cast("Butchery"),
      
      // actions.sentcleave+=/coordinated_assault,if=!talent.bombardier|talent.bombardier&cooldown.wildfire_bomb.charges_fractional<1
      Spell.cast("Coordinated Assault", () => 
        !this.hasTalent("Bombardier") || 
        (this.hasTalent("Bombardier") && Spell.getChargesFractional("Wildfire Bomb") < 1)),
      
      // actions.sentcleave+=/fury_of_the_eagle,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Fury of the Eagle", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.sentcleave+=/flanking_strike,if=(buff.tip_of_the_spear.stack=2|buff.tip_of_the_spear.stack=1)
      Spell.cast("Flanking Strike", () => 
        this.getTipOfTheSpearStacks() === 2 || this.getTipOfTheSpearStacks() === 1),
      
      // actions.sentcleave+=/kill_command,target_if=min:bloodseeker.remains,if=focus+cast_regen<focus.max
      Spell.cast("Kill Command", () => me.powerByType(PowerType.Focus) + 15 < 120),
      
      // actions.sentcleave+=/explosive_shot
      Spell.cast("Explosive Shot"),
      
      // actions.sentcleave+=/wildfire_bomb,if=buff.tip_of_the_spear.stack>0
      Spell.cast("Wildfire Bomb", () => this.getTipOfTheSpearStacks() > 0),
      
      // actions.sentcleave+=/kill_shot,if=buff.deathblow.remains&talent.sic_em
      Spell.cast("Kill Shot", () => 
        me.hasAura("Deathblow") && this.hasTalent("Sic 'Em")),
      
      // actions.sentcleave+=/raptor_bite,target_if=min:dot.serpent_sting.remains,if=!talent.contagious_reagents
      Spell.cast("Raptor Strike", () => !this.hasTalent("Contagious Reagents")),
      
      // actions.sentcleave+=/raptor_bite,target_if=max:dot.serpent_sting.remains
      Spell.cast("Raptor Strike")
    );
  }

  /**
   * Helper method to get the current target
   * @returns {wow.CGUnit | null} The current target or null if no valid target
   */
  getCurrentTarget() {
    const target = me.targetUnit;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Check if the Pack Leader hero talent is active
   * @returns {boolean} True if Pack Leader talent is active
   */
  hasPackLeader() {
    return me.hasAura("Vicious Hunt");
  }

  /**
   * Helper method to get the number of active enemies
   * @returns {number} The number of active enemies
   */
  activeEnemies() {
    return combat.targets.length;
  }

  /**
   * Helper method to get the remaining time on an aura
   * @param {string} auraName - The name of the aura
   * @returns {number} The remaining time in milliseconds
   */
  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining / 1000 : 0;
  }

  /**
   * Helper method to get stacks of an aura
   * @param {string} auraName - The name of the aura
   * @returns {number} The number of stacks
   */
  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  /**
   * Helper method to get the number of active dots of a specific type
   * @param {string} dotName - The name of the dot
   * @returns {number} The number of active dots
   */
  getActiveDotsCount(dotName) {
    let count = 0;
    combat.targets.forEach(target => {
      if (target.hasAuraByMe(dotName)) {
        count++;
      }
    });
    return count;
  }

  /**
   * Helper method to check if a talent is active
   * @param {string} talentName - The name of the talent
   * @returns {boolean} True if the talent is active
   */
  hasTalent(talentName) {
    return Spell.isSpellKnown(talentName);
  }

  /**
   * Helper method to get the number of Tip of the Spear stacks
   * @returns {number} The number of stacks
   */
  getTipOfTheSpearStacks() {
    return this.getAuraStacks("Tip of the Spear");
  }

  /**
   * Helper method to check if howl summon is ready
   * @returns {boolean} True if howl summon is ready
   */
  howlSummonReady() {
    // This is a placeholder since we don't have a way to check this directly
    // In the game this would involve checking specific talent conditions
    return false;
  }

  /**
   * Helper method to estimate target's time to die
   * @returns {number} Estimated time to die in seconds
   */
  getTimeToDie() {
    const target = this.getCurrentTarget();
    if (!target) return 9999;
    
    const ttd = target.timeToDeath();
    return ttd !== undefined ? ttd : 30;
  }
}