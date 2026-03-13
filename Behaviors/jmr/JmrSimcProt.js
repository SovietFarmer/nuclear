import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class WarriorProtNewBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Protection;
  name = "Jmr SimC Warrior Protection";

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
      spell.cast("Battle Shout", () => !me.hasAura("Battle Shout")),
      spell.cast("Rallying Cry", () => me.pctHealth < 30),
      spell.cast("Victory Rush", () => me.pctHealth < 70),
      spell.interrupt("Pummel", false),
      spell.interrupt("Storm Bolt", false),
      spell.cast("Taunt",
        on => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking),
        req => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking) !== undefined),
      new bt.Decorator(
        () => this.getEnemiesInRange(12) >= 1 && me.isWithinMeleeRange(this.getCurrentTarget()),
          this.useCooldowns(),
          new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemiesInRange(12) >= 1 && me.isWithinMeleeRange(this.getCurrentTarget()),
          this.useDefensives(),
          new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemiesInRange(12) >= 3,
        this.aoeRotation(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemiesInRange(12) < 3,
        this.genericRotation(),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  useCooldowns() {
    return new bt.Selector(
      new bt.Decorator(
        ret => me.hasAura("Inner Resilience"),
        common.useEquippedItemByName("Tome of Light's Devotion", on => me),
      ),
      spell.cast("Avatar", () => Boolean(!me.hasAura("Thunder Blast") || me.getAuraStacks("Thunder Blast") <= 2)),
      spell.cast("Shield Wall", () => Boolean(me.hasAura("Immovable Object") && !me.hasAura("Avatar")) || me.pctHealth < 50),
      spell.cast("Blood Fury"),
      spell.cast("Berserking"),
      spell.cast("Arcane Torrent"),
      spell.cast("Lights Judgment"),
      spell.cast("Fireblood"),
      spell.cast("Ancestral Call"),
      spell.cast("Bag of Tricks"),
      spell.cast("Last Stand", () => Boolean(this.shouldUseLastStand() || me.pctHealth < 60) && !me.hasAura("Shield Wall")),
      spell.cast("Ravager"),
      spell.cast("Demoralizing Shout", () => Boolean(me.hasAura("Booming Voice"))),
      spell.cast("Demolish", () => Boolean(me.getAuraStacks("Colossal Might") >= 3)),
      spell.cast("Champion's Spear"),
      spell.cast("Spear of Bastion"),
      spell.cast("Thunderous Roar"),
      spell.cast("Shield Charge")
    );
  }

  useDefensives() {
    return new bt.Selector(
      spell.cast("Shield Block", on => this.getCurrentTarget(), req => this.getAuraRemainingTime("Shield Block") <= 10),
      // spell.cast("Ignore Pain", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 70),
      // Commented out detailed rage management as requested
      spell.cast("Ignore Pain", on => this.getCurrentTarget(), req => {
        const rage = me.powerByType(PowerType.Rage);
        const rageDeficit = 100 - rage;
        return (
          this.getCurrentTarget().pctHealth >= 20 && (
            (rageDeficit <= 15 && spell.getCooldown("Shield Slam")?.ready) ||
            (rageDeficit <= 40 && spell.getCooldown("Shield Charge")?.ready && this.hasTalent("Champion's Bulwark")) ||
            (rageDeficit <= 20 && spell.getCooldown("Shield Charge")?.ready) ||
            (rageDeficit <= 30 && spell.getCooldown("Demoralizing Shout")?.ready && this.hasTalent("Booming Voice")) ||
            (rageDeficit <= 20 && spell.getCooldown("Avatar")?.ready) ||
            (rageDeficit <= 45 && spell.getCooldown("Demoralizing Shout")?.ready && this.hasTalent("Booming Voice") && me.hasAura("Last Stand") && this.hasTalent("Unnerving Focus")) ||
            (rageDeficit <= 30 && spell.getCooldown("Avatar")?.ready && me.hasAura("Last Stand") && this.hasTalent("Unnerving Focus")) ||
            rageDeficit <= 20 ||
            (rageDeficit <= 40 && spell.getCooldown("Shield Slam")?.ready && me.hasAura("Violent Outburst") && this.hasTalent("Heavy Repercussions") && this.hasTalent("Impenetrable Wall")) ||
            (rageDeficit <= 55 && spell.getCooldown("Shield Slam")?.ready && me.hasAura("Violent Outburst") && me.hasAura("Last Stand") && this.hasTalent("Unnerving Focus") && this.hasTalent("Heavy Repercussions") && this.hasTalent("Impenetrable Wall")) ||
            (rageDeficit <= 17 && spell.getCooldown("Shield Slam")?.ready && this.hasTalent("Heavy Repercussions")) ||
            (rageDeficit <= 18 && spell.getCooldown("Shield Slam")?.ready && this.hasTalent("Impenetrable Wall"))
          ) ||
          ((rage >= 70 || (me.getAuraStacks("Seeing Red") === 7 && rage >= 35)) &&
           spell.getCooldown("Shield Slam").remaining <= 1 &&
           this.getAuraRemainingTime("Shield Block") >= 4 &&
           me.hasSetBonus(31, 2))
        );
      })
    );
  }

  aoeRotation() {
    return new bt.Selector(
      // actions.aoe=thunder_blast,if=dot.rend.remains<=1
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 4),
      // actions.aoe+=/thunder_clap,if=dot.rend.remains<=1
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 4),
      // actions.aoe+=/thunder_blast,if=buff.violent_outburst.up&spell_targets.thunderclap>=2&buff.avatar.up&talent.unstoppable_force.enabled
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => me.hasAura("Violent Outburst") && this.getEnemiesInRange(8) >= 2 && me.hasAura("Avatar") && this.hasTalent("Unstoppable Force")),
      // actions.aoe+=/execute,if=spell_targets.execute>=2&(rage>=50|buff.sudden_death.up)&talent.heavy_handed.enabled
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 2 && (me.powerByType(PowerType.Rage) >= 50 || me.hasAura("Sudden Death")) && this.hasTalent("Heavy Handed")),
      // actions.aoe+=/thunder_clap,if=buff.violent_outburst.up&spell_targets.thunderclap>=4&buff.avatar.up&talent.unstoppable_force.enabled&talent.crashing_thunder.enabled|buff.violent_outburst.up&spell_targets.thunderclap>6&buff.avatar.up&talent.unstoppable_force.enabled
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => me.hasAura("Violent Outburst") && this.getEnemiesInRange(8) >= 4 && me.hasAura("Avatar") && this.hasTalent("Unstoppable Force") && this.hasTalent("Crashing Thunder") || me.hasAura("Violent Outburst") && this.getEnemiesInRange(8) > 6 && me.hasAura("Avatar") && this.hasTalent("Unstoppable Force")),
      // actions.aoe+=/revenge,if=rage>=70&talent.seismic_reverberation.enabled&spell_targets.revenge>=3
      spell.cast("Revenge", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 70 && this.hasTalent("Seismic Reverberation") && this.getEnemiesInRange(8) >= 3),
      // actions.aoe+=/shield_slam,if=rage<=60|buff.violent_outburst.up&spell_targets.thunderclap<=4&talent.crashing_thunder.enabled
      spell.cast("Shield Slam", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) <= 60 || me.hasAura("Violent Outburst") && this.getEnemiesInRange(8) <= 4 && this.hasTalent("Crashing Thunder")),
      // actions.aoe+=/thunder_blast
      spell.cast("Thunder Blast", on => this.getCurrentTarget()),
      // actions.aoe+=/thunder_clap
      spell.cast("Thunder Clap", on => this.getCurrentTarget()),
      // actions.aoe+=/revenge,if=rage>=30|rage>=40&talent.barbaric_training.enabled
      spell.cast("Revenge", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 30 || me.powerByType(PowerType.Rage) >= 40 && this.hasTalent("Barbaric Training"))
    );
  }

  genericRotation() {
    return new bt.Selector(
      // actions.generic=thunder_blast,if=(buff.thunder_blast.stack=2&buff.burst_of_power.stack<=1&buff.avatar.up&talent.unstoppable_force.enabled)|rage<=70&talent.demolish.enabled
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => (me.getAuraStacks("Thunder Blast") === 2 && me.getAuraStacks("Burst of Power") <= 1 && me.hasAura("Avatar") && this.hasTalent("Unstoppable Force")) || me.powerByType(PowerType.Rage) <= 70 && me.hasAura("Demolish")),
      // actions.generic+=/shield_slam,if=(buff.burst_of_power.stack=2&buff.thunder_blast.stack<=1|buff.violent_outburst.up)|rage<=70&talent.demolish.enabled
      spell.cast("Shield Slam", on => this.getCurrentTarget(), req => (me.getAuraStacks("Burst of Power") === 2 && me.getAuraStacks("Thunder Blast") <= 1 || me.hasAura("Violent Outburst")) || me.powerByType(PowerType.Rage) <= 70 && this.hasTalent("Demolish")),
      // actions.generic+=/execute,if=rage>=70|(rage>=40&cooldown.shield_slam.remains&talent.demolish.enabled|rage>=50&cooldown.shield_slam.remains)|buff.sudden_death.up&talent.sudden_death.enabled
      spell.cast("Execute", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Rage) >= 70 || (me.powerByType(PowerType.Rage) >= 40 && !spell.getCooldown("Shield Slam")?.ready && this.hasTalent("Demolish")) || (me.powerByType(PowerType.Rage) >= 50 && !spell.getCooldown("Shield Slam")?.ready) || (me.hasAura("Sudden Death") && this.hasTalent("Sudden Death"))),
      // actions.generic+=/shield_slam
      spell.cast("Shield Slam", on => this.getCurrentTarget()),
      // actions.generic+=/thunder_blast,if=dot.rend.remains<=2&buff.violent_outburst.down
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 2 && !me.hasAura("Violent Outburst")),
      // actions.generic+=/thunder_blast
      spell.cast("Thunder Blast", on => this.getCurrentTarget()),
      // actions.generic+=/thunder_clap,if=dot.rend.remains<=2&buff.violent_outburst.down
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getDebuffRemainingTime("Rend") <= 2 && !me.hasAura("Violent Outburst")),
      // actions.generic+=/thunder_blast,if=(spell_targets.thunder_clap>1|cooldown.shield_slam.remains&!buff.violent_outburst.up)
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 1 || !spell.getCooldown("Shield Slam")?.ready && !me.hasAura("Violent Outburst")),
      // actions.generic+=/thunder_clap,if=(spell_targets.thunder_clap>1|cooldown.shield_slam.remains&!buff.violent_outburst.up)
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => this.getEnemiesInRange(8) >= 1 || !spell.getCooldown("Shield Slam")?.ready && !me.hasAura("Violent Outburst")),
      // actions.generic+=/revenge,if=(rage>=80&target.pctHealth>20|buff.revenge.up&target.pctHealth<=20&rage<=18&cooldown.shield_slam.remains|buff.revenge.up&target.pctHealth>20)|(rage>=80&target.pctHealth>35|buff.revenge.up&target.pctHealth<=35&rage<=18&cooldown.shield_slam.remains|buff.revenge.up&target.pctHealth>35)&talent.massacre.enabled
      spell.cast("Revenge", on => this.getCurrentTarget(), req => (me.powerByType(PowerType.Rage) >= 80 && this.getCurrentTarget().pctHealth > 20 || me.hasVisibleAura("Revenge") && this.getCurrentTarget().pctHealth <= 20 && me.powerByType(PowerType.Rage) <= 18 && !spell.getCooldown("Shield Slam")?.ready || me.hasVisibleAura("Revenge") && this.getCurrentTarget().pctHealth > 20) || (me.powerByType(PowerType.Rage) >= 80 && this.getCurrentTarget().pctHealth > 35 || me.hasAura("Revenge") && this.getCurrentTarget().pctHealth <= 35 && me.powerByType(PowerType.Rage) <= 18 && !spell.getCooldown("Shield Slam")?.ready || me.hasAura("Revenge") && this.getCurrentTarget().pctHealth > 35 && this.hasTalent("Massacre"))),
      // actions.generic+=/execute
      spell.cast("Execute", on => this.getCurrentTarget()),
      // actions.generic+=/revenge,if=target.health>20
      spell.cast("Revenge", on => this.getCurrentTarget()),
      // actions.generic+=/thunder_blast,if=(spell_targets.thunder_clap>=1|cooldown.shield_slam.remains&buff.violent_outburst.up)
      spell.cast("Thunder Blast", on => this.getCurrentTarget(), req => (this.getEnemiesInRange(8) >= 1 || !spell.getCooldown("Shield Slam")?.ready && me.hasAura("Violent Outburst"))),
      // actions.generic+=/thunder_clap,if=(spell_targets.thunder_clap>=1|cooldown.shield_slam.remains&buff.violent_outburst.up)
      spell.cast("Thunder Clap", on => this.getCurrentTarget(), req => (this.getEnemiesInRange(8) >= 1 || !spell.getCooldown("Shield Slam")?.ready && me.hasAura("Violent Outburst"))),
      // actions.generic+=/devastate
      spell.cast("Devastate", on => this.getCurrentTarget())
    );
  }

  shouldUseLastStand() {
    const target = this.getCurrentTarget();
    return (
      (target && target.pctHealth >= 90 && this.hasTalent("Unnerving Focus")) ||
      (target && target.pctHealth <= 20 && this.hasTalent("Unnerving Focus")) ||
      this.hasTalent("Bolster")
    );
  }

  shouldUseRevenge() {
    const target = this.getCurrentTarget();
    const rage = me.powerByType(PowerType.Rage);
    return (
      (rage >= 80 && target.pctHealth > 20) ||
      (me.hasVisibleAura("Revenge") && target.pctHealth <= 20 && rage <= 18 && !spell.getCooldown("Shield Slam")?.ready) ||
      (me.hasVisibleAura("Revenge") && target.pctHealth > 20) ||
      (rage >= 80 && target.pctHealth > 35) ||
      (me.hasVisibleAura("Revenge") && target.pctHealth <= 35 && rage <= 18 && !spell.getCooldown("Shield Slam")?.ready) ||
      (me.hasVisibleAura("Revenge") && target.pctHealth > 35 && this.hasTalent("Massacre"))
    );
  }

  shouldUseCooldowns() {
    const target = this.getCurrentTarget();
    return target.timeToDeath() > 15 && !me.hasAura("Smothering Shadows");
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    const debuff = target ? target.getAura(debuffName) : null;
    return debuff ? debuff.remaining : 0;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }
}
