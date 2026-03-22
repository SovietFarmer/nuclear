import { Behavior, BehaviorContext } from "../../Core/Behavior";
import * as bt from '../../Core/BehaviorTree';
import Specialization from '../../Enums/Specialization';
import common from '../../Core/Common';
import spell from "../../Core/Spell";
import { me } from "../../Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";

class NuclearWarrior extends Behavior {
  talentSpellIds = {
    angerManagement: 152278,
    titansTorment: 390135,
    titanicRage: 394329,
    improvedWhirlwind: 12950,
    ashenJuggernaut: 392536,
    massacre: 383103,
    tenderize: 388933,
    recklessAbandon: 396749,
    dancingBlades: 391683
  };

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const debuff = me.targetUnit.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getDebuffStacks(debuffName) {
    const debuff = me.targetUnit.getAura(debuffName);
    return debuff ? debuff.stacks : 0;
  }

  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  timeToAdds() {
    return 9999;
  }
}

export class NuclearWarriorFuryBehavior extends NuclearWarrior {
  name = "Nuclear Fury";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Fury;

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForTarget(),
      common.waitForCastOrChannel(),
      common.waitForFacing(),
      spell.cast("Victory Rush", () => me.pctHealth < 70),
      spell.cast("Bloodthirst", () => me.pctHealth < 70 && me.hasAuraByMe("Enraged Regeneration")),
      this.useCooldowns(),
      new bt.Decorator(
        () => Boolean(me.getUnitsAroundCount(8) >= 2),
        new bt.Selector(
          this.multiTargetRotation(),
          new bt.Action(() => bt.Status.Success)
        )
      ),
      new bt.Decorator(
        () => Boolean(me.isWithinMeleeRange(me.target)),
        this.singleTargetRotation()
      )
    );
  }

  useCooldowns() {
    return new bt.Selector(
      spell.cast("Lights Judgment", () => Boolean(!me.hasVisibleAura("Recklessness"))),
      spell.cast("Berserking", () => Boolean(me.hasVisibleAura("Recklessness"))),
      spell.cast("Blood Fury"),
      spell.cast("Fireblood"),
      spell.cast("Ancestral Call")
    );
  }

  multiTargetRotation() {
    return new bt.Selector(
      spell.cast("Recklessness", () => Boolean(
        (!me.hasAura(this.talentSpellIds.angerManagement) && spell.getCooldown("Avatar").timeleft < 1 && me.hasAura(this.talentSpellIds.titansTorment)) ||
        me.hasAura(this.talentSpellIds.angerManagement) ||
        !me.hasAura(this.talentSpellIds.titansTorment)
      )),
      spell.cast("Avatar", () => Boolean(
        (me.hasAura(this.talentSpellIds.titansTorment) && (me.hasVisibleAura("Enrage") || me.hasAura(this.talentSpellIds.titanicRage))) ||
        !me.hasAura(this.talentSpellIds.titansTorment)
      )),
      spell.cast("Thunderous Roar", () => Boolean(me.hasVisibleAura("Enrage"))),
      spell.cast("Champions Spear", () => Boolean(me.hasVisibleAura("Enrage"))),
      spell.cast("Odyn's Fury", () => Boolean(
        (this.getDebuffRemainingTime("385060") < 1 || !me.targetUnit.getAura(385060)) &&
        (me.hasVisibleAura("Enrage") || me.hasAura(this.talentSpellIds.titanicRage)) &&
        spell.getCooldown("Avatar").timeleft > 0
      )),
      spell.cast("Whirlwind", () => Boolean(this.getAuraStacks("Whirlwind") === 0 && me.hasAura(this.talentSpellIds.improvedWhirlwind))),
      spell.cast("Execute", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        this.getAuraRemainingTime("Ashen Juggernaut") <= 1.5 &&
        me.hasAura(this.talentSpellIds.ashenJuggernaut)
      )),
      spell.cast("Rampage", () => Boolean(
        me.rage >= 85 &&
        spell.getCooldown("Bladestorm").timeleft <= 1.5 &&
        !me.targetUnit.hasAura("Champions Might")
      )),
      spell.cast("Bladestorm", () => Boolean(me.hasVisibleAura("Enrage") && spell.getCooldown("Avatar").timeleft >= 9)),
      spell.cast("Ravager", () => Boolean(me.hasVisibleAura("Enrage"))),
      spell.cast("Rampage", () => Boolean(me.hasAura(this.talentSpellIds.angerManagement))),
      spell.cast("Bloodbath", () => Boolean(me.hasVisibleAura("Furious Bloodthirst"))),
      spell.cast("Crushing Blow"),
      spell.cast("Onslaught", () => Boolean(me.hasAura(this.talentSpellIds.tenderize) || me.hasVisibleAura("Enrage"))),
      spell.cast("Bloodbath", () => Boolean(!me.targetUnit.hasAuraByMe("Gushing Wound"))),
      spell.cast("Rampage", () => Boolean(me.hasAura(this.talentSpellIds.recklessAbandon))),
      spell.cast("Execute", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        ((me.targetUnit.health.pct > 35 && me.hasAura(this.talentSpellIds.massacre)) || me.targetUnit.health.pct > 20) &&
        this.getAuraRemainingTime("Sudden Death") <= 1.5
      )),
      spell.cast("Bloodbath"),
      spell.cast("Bloodthirst"),
      spell.cast("Raging Blow"),
      spell.cast("Execute"),
      spell.cast("Whirlwind")
    );
  }

  singleTargetRotation() {
    return new bt.Selector(
      spell.cast("Ravager", () => Boolean(spell.getCooldown("Recklessness").timeleft < 1.5 || me.hasVisibleAura("Recklessness"))),
      spell.cast("Recklessness", () => Boolean(
        !me.hasAura(this.talentSpellIds.angerManagement) ||
        (me.hasAura(this.talentSpellIds.angerManagement) && (spell.getCooldown("Avatar").ready || spell.getCooldown("Avatar").timeleft < 1.5 || spell.getCooldown("Avatar").timeleft > 30))
      )),
      spell.cast("Avatar", () => Boolean(
        !me.hasAura(this.talentSpellIds.titansTorment) ||
        (me.hasAura(this.talentSpellIds.titansTorment) && (me.hasVisibleAura("Enrage") || me.hasAura(this.talentSpellIds.titanicRage)))
      )),
      spell.cast("Champions Spear", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        ((me.hasVisibleAura("Furious Bloodthirst") && me.hasAura(this.talentSpellIds.titansTorment)) ||
          !me.hasAura(this.talentSpellIds.titansTorment) ||
          me.targetUnit.timeToDie < 20 ||
          this.getEnemiesInRange(8) > 1)
      )),
      spell.cast("Whirlwind", () => Boolean(
        (this.getEnemiesInRange(8) > 1 && me.hasAura(this.talentSpellIds.improvedWhirlwind) && !me.hasVisibleAura("Meat Cleaver")) ||
        (this.timeToAdds() < 2 && me.hasAura(this.talentSpellIds.improvedWhirlwind) && !me.hasVisibleAura("Meat Cleaver"))
      )),
      spell.cast("Execute", () => Boolean(
        me.hasVisibleAura("Ashen Juggernaut") &&
        this.getAuraRemainingTime("Ashen Juggernaut") < 1.5
      )),
      spell.cast("Bladestorm", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        (me.hasVisibleAura("Avatar") || (me.hasVisibleAura("Recklessness") && me.hasAura(this.talentSpellIds.angerManagement)))
      )),
      spell.cast("Odyns Fury", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        (this.getEnemiesInRange(8) > 1 || this.timeToAdds() > 15) &&
        (me.hasAura(this.talentSpellIds.dancingBlades) && this.getAuraRemainingTime("Dancing Blades") < 5 || !me.hasAura(this.talentSpellIds.dancingBlades))
      )),
      spell.cast("Rampage", () => Boolean(
        me.hasAura(this.talentSpellIds.angerManagement) &&
        (me.hasVisibleAura("Recklessness") || this.getAuraRemainingTime("Enrage") < 1.5 || me.rage > 85)
      )),
      spell.cast("Bloodthirst", () => Boolean(
        (!me.hasAura(this.talentSpellIds.recklessAbandon) &&
          me.hasVisibleAura("Furious Bloodthirst") &&
          me.hasVisibleAura("Enrage") &&
          (!me.targetUnit.hasAuraByMe("Gushing Wound") || me.hasVisibleAura("Champions Might")))
      )),
      spell.cast("Bloodbath", () => Boolean(me.hasVisibleAura("Furious Bloodthirst"))),
      spell.cast("Thunderous Roar", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        (this.getEnemiesInRange(8) > 1 || this.timeToAdds() > 15)
      )),
      spell.cast("Onslaught", () => Boolean(me.hasVisibleAura("Enrage") || me.hasAura(this.talentSpellIds.tenderize))),
      spell.cast("Crushing Blow", () => Boolean(me.hasVisibleAura("Enrage"))),
      spell.cast("Rampage", () => Boolean(
        me.hasAura(this.talentSpellIds.recklessAbandon) &&
        (me.hasVisibleAura("Recklessness") || this.getAuraRemainingTime("Enrage") < 1.5 || me.rage > 85)
      )),
      spell.cast("Execute", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        !me.hasVisibleAura("Furious Bloodthirst") &&
        me.hasVisibleAura("Ashen Juggernaut") ||
        this.getAuraRemainingTime("Sudden Death") <= 1.5 &&
        (me.targetUnit.health.pct > 35 && me.hasAura(this.talentSpellIds.massacre) || me.targetUnit.health.pct > 20)
      )),
      spell.cast("Execute", () => Boolean(me.hasVisibleAura("Enrage"))),
      spell.cast("Rampage", () => Boolean(me.hasAura(this.talentSpellIds.angerManagement))),
      spell.cast("Bloodbath", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        me.hasAura(this.talentSpellIds.recklessAbandon)
      )),
      spell.cast("Rampage", () => Boolean(me.targetUnit.health.pct < 35 && me.hasAura(this.talentSpellIds.massacre))),
      spell.cast("Bloodthirst", () => Boolean(!me.hasVisibleAura("Enrage") || !me.hasVisibleAura("Furious Bloodthirst"))),
      spell.cast("Raging Blow", () => Boolean(spell.getCharges("Raging Blow") > 1)),
      spell.cast("Crushing Blow", () => Boolean(spell.getCharges("Raging Blow") > 1)),
      spell.cast("Bloodbath", () => Boolean(!me.hasVisibleAura("Enrage"))),
      spell.cast("Crushing Blow", () => Boolean(
        me.hasVisibleAura("Enrage") &&
        me.hasAura(this.talentSpellIds.recklessAbandon)
      )),
      spell.cast("Bloodthirst", () => Boolean(!me.hasVisibleAura("Furious Bloodthirst"))),
      spell.cast("Raging Blow", () => Boolean(spell.getCharges("Raging Blow") > 1)),
      spell.cast("Rampage"),
      spell.cast("Bloodbath"),
      spell.cast("Raging Blow"),
      spell.cast("Crushing Blow"),
      spell.cast("Bloodthirst"),
      spell.cast("Slam")
    );
  }
}

export class NuclearWarriorProtectionBehavior extends NuclearWarrior {
  name = "Nuclear Protection"
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Protection;

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForTarget(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        () => Boolean(me.isWithinMeleeRange(me.target)),
        new bt.Selector(
          this.useCooldowns(),
          this.useDefensives(),
          new bt.Decorator(
            () => Boolean(me.getUnitsAroundCount(8) >= 3),
            this.aoeRotation()
          ),
          this.genericRotation()
        )
      )
    );
  }

  useCooldowns() {
    return new bt.Selector(
      spell.cast("Avatar", () => Boolean(!me.hasVisibleAura("Thunder Blast") || me.getAuraStacks("Thunder Blast") <= 2)),
      spell.cast("Shield Wall", () => Boolean(me.hasVisibleAura("Immovable Object") && !me.hasVisibleAura("Avatar"))),
      spell.cast("Blood Fury"),
      spell.cast("Berserking"),
      spell.cast("Arcane Torrent"),
      spell.cast("Lights Judgment"),
      spell.cast("Fireblood"),
      spell.cast("Ancestral Call"),
      spell.cast("Bag of Tricks"),
      spell.cast("Potion", () => Boolean(me.hasVisibleAura("Avatar") || (me.hasVisibleAura("Avatar") && me.targetUnit.health.pct <= 20))),
      spell.cast("Last Stand", () => Boolean(this.shouldUseLastStand()) && !me.hasVisibleAura("Shield Wall")),
      spell.cast("Ravager"),
      spell.cast("Demoralizing Shout", () => Boolean(me.hasVisibleAura("Booming Voice"))),
      spell.cast("Spear of Bastion"),
      spell.cast("Thunderous Roar"),
      spell.cast("Shield Charge")
    );
  }

  useDefensives() {
    return new bt.Selector(
      spell.cast("Ignore Pain", () => Boolean(me.powerByType(PowerType.Rage) >= 90)),
      spell.cast("Shield Block", () => Boolean(this.getAuraRemainingTime("Shield Block") <= 10000)),
      spell.cast("Shield Wall", () => Boolean(me.health.pct <= 30)),
      spell.cast("Last Stand", () => Boolean(me.health.pct <= 30) && !me.hasVisibleAura("Shield Wall")),
    );
  }

  aoeRotation() {
    return new bt.Selector(
      spell.cast("Thunder Blast", () => Boolean(this.getAuraRemainingTime("Rend") <= 1000)),
      spell.cast("Thunder Clap", () => Boolean(this.getAuraRemainingTime("Rend") <= 1000)),
      spell.cast("Thunder Blast", () => Boolean(me.hasVisibleAura("Violent Outburst") && me.getUnitsAroundCount(8) >= 2 && me.hasVisibleAura("Avatar") && me.hasVisibleAura("Unstoppable Force"))),
      spell.cast("Thunder Clap", () => Boolean(me.hasVisibleAura("Violent Outburst") && me.getUnitsAroundCount(8) >= 4 && me.hasVisibleAura("Avatar") && me.hasVisibleAura("Unstoppable Force") && me.hasVisibleAura("Crashing Thunder"))),
      spell.cast("Thunder Clap", () => Boolean(me.hasVisibleAura("Violent Outburst") && me.getUnitsAroundCount(8) > 6 && me.hasVisibleAura("Avatar") && me.hasVisibleAura("Unstoppable Force"))),
      spell.cast("Revenge", () => Boolean(me.powerByType(PowerType.Rage) >= 70 && me.hasVisibleAura("Seismic Reverberation") && me.getUnitsAroundCount(8) >= 3)),
      spell.cast("Shield Slam", () => Boolean(me.powerByType(PowerType.Rage) <= 60 || me.hasVisibleAura("Violent Outburst") && me.getUnitsAroundCount(8) <= 4 && me.hasVisibleAura("Crashing Thunder"))),
      spell.cast("Thunder Blast"),
      spell.cast("Thunder Clap"),
      spell.cast("Revenge", () => Boolean(me.powerByType(PowerType.Rage) >= 30 || me.powerByType(PowerType.Rage) >= 40 && me.hasVisibleAura("Barbaric Training")))
    );
  }

  genericRotation() {
    return new bt.Selector(
      spell.cast("Thunder Blast", () => Boolean(me.getAuraStacks("Thunder Blast") === 2 && me.getAuraStacks("Burst of Power") <= 1 && me.hasVisibleAura("Avatar") && me.hasVisibleAura("Unstoppable Force"))),
      spell.cast("Shield Slam", () => Boolean(me.getAuraStacks("Burst of Power") === 2 && me.getAuraStacks("Thunder Blast") <= 1 || me.hasVisibleAura("Violent Outburst") || me.powerByType(PowerType.Rage) <= 70 && me.hasVisibleAura("Demolish"))),
      spell.cast("Execute", () => Boolean(me.powerByType(PowerType.Rage) >= 70 || me.powerByType(PowerType.Rage) >= 40 && spell.getCooldown("Shield Slam").remaining && me.hasVisibleAura("Demolish") || me.powerByType(PowerType.Rage) >= 50 && spell.getCooldown("Shield Slam").remaining || me.hasVisibleAura("Sudden Death") && me.hasVisibleAura("Sudden Death"))),
      spell.cast("Shield Slam"),
      spell.cast("Thunder Blast", () => Boolean(this.getAuraRemainingTime("Rend") <= 2 && !me.hasVisibleAura("Violent Outburst"))),
      spell.cast("Thunder Blast"),
      spell.cast("Thunder Clap", () => Boolean(this.getAuraRemainingTime("Rend") <= 2 && !me.hasVisibleAura("Violent Outburst"))),
      spell.cast("Thunder Blast", () => Boolean(me.getUnitsAroundCount(8) >= 1 || spell.getCooldown("Shield Slam").remaining && !me.hasVisibleAura("Violent Outburst"))),
      spell.cast("Thunder Clap", () => Boolean(me.getUnitsAroundCount(8) >= 1 || spell.getCooldown("Shield Slam").remaining && !me.hasVisibleAura("Violent Outburst"))),
      //spell.cast("Revenge", () => Boolean(me.powerByType(PowerType.Rage) >= 80 && me.targetUnit.health.pct > 20 || me.hasVisibleAura("Revenge") && me.targetUnit.health.pct <= 20 && me.powerByType(PowerType.Rage) <= 18 && spell.getCooldown("Shield Slam").remaining || me.hasVisibleAura("Revenge") && me.targetUnit.health.pct > 20 || me.powerByType(PowerType.Rage) >= 80 && me.targetUnit.health.pct > 35 || me.hasVisibleAura("Revenge") && me.targetUnit.health.pct <= 35 && me.powerByType(PowerType.Rage) <= 18 && spell.getCooldown("Shield Slam").remaining || me.hasVisibleAura("Revenge") && me.targetUnit.health.pct > 35 && me.hasVisibleAura("Massacre"))),
      spell.cast("Execute"),
      spell.cast("Revenge"),
      spell.cast("Thunder Blast", () => Boolean(me.getUnitsAroundCount(8) >= 1 || spell.getCooldown("Shield Slam").remaining && me.hasVisibleAura("Violent Outburst"))),
      spell.cast("Thunder Clap", () => Boolean(me.getUnitsAroundCount(8) >= 1 || spell.getCooldown("Shield Slam").remaining && me.hasVisibleAura("Violent Outburst"))),
      spell.cast("Devastate")
    );
  }

  shouldUseLastStand() {
    return (
      (me.targetUnit.health.pct >= 90 && me.hasTalent("Unnerving Focus")) ||
      (me.targetUnit.health.pct <= 20 && me.hasTalent("Unnerving Focus")) ||
      me.hasVisibleAura("Bolster") ||
      me.health.pct <= 30
    );
  }
}