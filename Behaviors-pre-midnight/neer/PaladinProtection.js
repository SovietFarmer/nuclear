import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { MovementFlags } from "@/Enums/Flags";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";

const auras = {
  consecration: 188370,
  shininglight: 327510,
  avengingwrath: 31884,
  judgment: 197277,
  holybulwark: 432496,
}

export class PaladinProtectionBehavior extends Behavior {
  name = "Paladin [Protection]";
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Protection;
  static settings = [
    { type: "slider", uid: "ProtectionPaladinWoGPercent", text: "Word of Glory Percent", min: 0, max: 100, default: 70 },
    { type: "slider", uid: "ProtectionPaladinArdentADPercent", text: "Ardent Defender Percent", min: 0, max: 100, default: 25 }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      this.interruptRotation(),
      this.tauntRotation(),
      this.defensiveRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.emergencyHealingRotation(),
          this.massInterruptRotation(),
          common.waitForTarget(),
          this.mainTankingRotation(),
          new bt.Decorator(
            ret => combat.targets.length > 1,
            this.multiTargetDamageRotation()
          ),
          this.singleTargetDamageRotation()
        )
      )
    );
  }

  interruptRotation() {
    return new bt.Selector(
      spell.interrupt("Rebuke")
    );
  }

  tauntRotation() {
    return new bt.Selector(
      spell.cast("Hand of Reckoning", on => this.findTauntTarget())
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Ardent Defender",
        on => me,
        req => me.pctHealth < Settings.ProtectionPaladinArdentADPercent && this.isInDanger()
      ),
      spell.cast("Devotion Aura",
        on => me,
        req => !me.hasAura("Devotion Aura")
      )
    );
  }

  emergencyHealingRotation() {
    return new bt.Selector(
      spell.cast("Word of Glory", on => this.findWordOfGloryTarget()),
      spell.cast("Lay on Hands", on => this.findLayOnHandsTarget()),
      spell.cast("Blessing of Protection", on => this.findBlessingOfProtectionTarget()),
      spell.cast("Blessing of Freedom", on => this.findBlessingOfFreedomTarget())
    );
  }

  massInterruptRotation() {
    return new bt.Decorator(
      ret => this.shouldUseMassInterrupt(),
      new bt.Sequence(
        spell.cast("Sentinel"),
        spell.cast("Divine Toll")
      )
    );
  }

  mainTankingRotation() {
    return new bt.Selector(
      spell.cast("Shield of the Righteous", on => this.findShieldOfTheRighteousTarget()),
      spell.cast("Consecration", req => this.shouldCastConsecration()),
      spell.cast("Avenger's Shield", on => this.findInterruptTarget()),
    );
  }

  singleTargetDamageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),
      spell.cast("Avenging Wrath", on => me, req => combat.bestTarget && me.isWithinMeleeRange(combat.bestTarget)),
      spell.cast("Sacred Weapon", on => me, req => !me.hasAura(auras.avengingwrath)),
      spell.cast("Moment of Glory", on => me),
      spell.cast("Bastion of Light", on => me),
      spell.cast("Hammer of Wrath"),
      spell.cast("Judgment"),
      spell.cast("Divine Toll", req => me.powerByType(PowerType.HolyPower) <= 4),
      spell.cast("Holy Bulwark", req => spell.getCharges("Holy Bulwark") == 2),
      spell.cast("Avenger's Shield"),
      spell.cast("Holy Bulwark", req => spell.getCharges("Holy Bulwark") == 1),
      spell.cast("Blessed Hammer"),
      spell.cast("Word of Glory", on => me, req => me.hasAura(auras.shininglight))
    );
  }

  multiTargetDamageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),
      spell.cast("Avenging Wrath", on => me, req => combat.bestTarget && me.isWithinMeleeRange(combat.bestTarget)),
      spell.cast("Sacred Weapon", on => me, req => !me.hasAura(auras.avengingwrath)),
      spell.cast("Bastion of Light", on => me),
      spell.cast("Avenger's Shield"),
      spell.cast("Hammer of Wrath"),
      spell.cast("Judgment"),
      spell.cast("Divine Toll", req => me.powerByType(PowerType.HolyPower) == 0),
      spell.cast("Holy Bulwark"),
      spell.cast("Blessed Hammer"),
      spell.cast("Word of Glory", on => me, req => me.hasAura(auras.shininglight))
    );
  }

  findTauntTarget() {
    return combat.targets.find(unit => unit.inCombat() && unit.target && !unit.isTanking());
  }

  findShieldOfTheRighteousTarget() {
    const shieldSpell = spell.getSpell("Shield of the Righteous");
    return combat.targets.find(unit => shieldSpell.inRange(unit) && me.isFacing(unit, 30));
  }

  findWordOfGloryTarget() {
    if (!me.hasAura(auras.shininglight)) return null;
    return heal.friends.All.find(unit => unit.pctHealth < Settings.ProtectionPaladinWoGPercent);
  }

  findLayOnHandsTarget() {
    return heal.friends.All.find(unit => unit.pctHealth < 20);
  }

  findBlessingOfProtectionTarget() {
    return heal.friends.All.find(unit =>
      unit.pctHealth < 50 &&
      unit.guid !== me.guid &&
      combat.targets.find(enemy =>
        enemy.targetUnit &&
        enemy.targetUnit.guid === unit.guid &&
        enemy.isWithinMeleeRange(unit)
      )
    );
  }

  findBlessingOfFreedomTarget() {
    return heal.friends.All.find(unit => unit.isRooted() || unit.isSlowed());
  }

  findInterruptTarget() {
    return combat.targets
      .filter(unit => unit.isCastingOrChanneling && unit.isInterruptible && me.isFacing(unit))
      .sort((a, b) => b.distanceTo(me) - a.distanceTo(me))[0];
  }

  findHammerOfWrathTarget() {
    return combat.targets.find(unit =>
      (unit.pctHealth < 20 || me.hasAura(auras.avengingwrath)) &&
      me.isFacing(unit)
    );
  }

  findAvengersShieldTarget() {
    return combat.targets.find(unit => me.isFacing(unit) && !unit.isTanking());
  }

  findJudgmentTargetWithoutDebuff() {
    return combat.targets.find(unit => me.isFacing(unit) && !unit.isTanking());
  }

  findJudgmentTarget() {
    const target = combat.targets.find(target => !target.hasAura(auras.judgment));
    return target || combat.bestTarget;
  }

  isInDanger() {
    return combat.targets.find(unit => unit.isTanking());
  }

  shouldUseMassInterrupt() {
    return combat.targets.filter(unit =>
      unit.isCastingOrChanneling && unit.isInterruptible
    ).length > 2;
  }

  shouldCastConsecration() {
    const consecrationAura = me.auras.find(aura => aura.spellId === auras.consecration);
    const auraExpiring = !consecrationAura || (consecrationAura.remaining < 1500 && consecrationAura.remaining !== 0);
    const targetInRange = combat.targets.find(unit => me.isWithinMeleeRange(unit) || unit.distanceTo(me) < 14);
    return auraExpiring && targetInRange;
  }
}
