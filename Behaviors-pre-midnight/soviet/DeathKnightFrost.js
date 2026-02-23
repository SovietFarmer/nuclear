import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from "@/Enums/Specialization";
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const auras = {
  darkSuccor: 101568,
  killingMachine: 51124,
  rime: 59052,
  coldHeart: 281209,
  pillarOfFrost: 51271,
  deathAndDecay: 188290,
  icyTalons: 194879,
  unleashedFrenzy: 376907,
  razorice: 51714,
  frostFever: 55095,
  breathOfSindragosa: 152279,
};

export class DeathKnightFrostBehavior extends Behavior {
  name = "Frost DK PVE";
  context = BehaviorContext.Any; // PVP ?
  specialization = Specialization.DeathKnight.Frost;
  static settings = [
    {type: "checkbox", uid: "FrostDKUseSmackyHands", text: "Use Smacky Hands", default: true},
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.interrupt("Mind Freeze"),
      common.waitForTarget(),
      common.waitForFacing(),
      common.ensureAutoAttack(),
      spell.cast("Death Strike", ret => me.pctHealth < 95 && me.hasAura(auras.darkSuccor)),
      spell.cast("Death Strike", ret => me.pctHealth < 65 && me.power > 35 && !(this.isSindyActive())),
      spell.cast("Frost Strike", ret => this.checkFrostStrikeKeepUpBuffs()),
      spell.cast("Howling Blast", on => me.target, ret => !me.target.hasAuraByMe(auras.frostFever)),
      // Decorator: Do I have Breath of Sindragosa?
      new bt.Decorator(
        () => this.doIKnowSindy(),
        new bt.Selector(
          // Inside this, we will have two decorators: one for cooldowns and one for regular rotation
          // Decorator for cooldowns/burst
          new bt.Decorator(
            () => this.wantCooldowns() && this.getSindyCooldown().ready,
            new bt.Selector(
              this.useAbomLimb(),
              spell.cast("Remorseless Winter", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Reaper's Mark", on => me.targetUnit, ret => spell.isSpellKnown("Reaper's Mark") && me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Pillar of Frost", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Rune Strike", ret => me.getReadyRunes() >= 2),
              spell.cast("Death and Decay", ret => !(me.hasAura(auras.deathAndDecay))),
              spell.cast("Breath of Sindragosa", ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && ((me.getReadyRunes() < 2 && me.power > 90) || me.power > 110)),
            )
          ),
          // Decorator for pillar of frost and reaper's mark
          new bt.Decorator(
            () => this.wantCooldowns() && this.getSindyCooldown().timeleft > 45000,
            new bt.Selector(
              spell.cast("Reaper's Mark", on => me.targetUnit, ret => spell.isSpellKnown("Reaper's Mark") && me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Pillar of Frost", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
            )
          ),

          // Decorator for sindy rotation
          new bt.Decorator(
            () => this.isSindyActive(),
            new bt.Selector(
              spell.cast("Empower Rune Weapon", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && me.power < 70),
              this.useTrinkets(),
              spell.cast("Remorseless Winter", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && me.power > 70),
              this.multiTargetRotation(),
              spell.cast("Rune Strike", ret => me.getAuraStacks(auras.killingMachine) > 1),
              spell.cast("Soul Reaper", on => me.target, ret => me.targetUnit.pctHealth < 35 && me.power > 50),
              spell.cast("Howling Blast", ret => me.hasAura(auras.rime) && me.power > 60),
              spell.cast("Rune Strike", ret => me.hasAura(auras.killingMachine) && me.power < 100),
              spell.cast("Horn of Winter", ret => me.targetUnit && me.power < 70 && me.getReadyRunes() <= 4),
              spell.cast("Death and Decay", ret => !(me.hasAura(auras.deathAndDecay))),
              this.useAbomLimb(),
              spell.cast("Rune Strike", ret => me.power < 70),
            )
          ),

          // Decorator for sindy rotation
          new bt.Decorator(
            () => (!this.isSindyActive()) && (this.getSindyCooldown().timeleft > 3000 || !this.wantCooldowns()),
            new bt.Selector(
              spell.cast("Frost Strike", ret => this.checkFrostStrikeKeepUpBuffs()),
              spell.cast("Remorseless Winter", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              this.multiTargetRotation(),
              spell.cast("Soul Reaper", on => me.target, ret => me.targetUnit.pctHealth < 35),
              spell.cast("Rune Strike", ret => me.getAuraStacks(auras.killingMachine) > 1),
              spell.cast("Frost Strike", ret => me.hasAura(auras.killingMachine) && me.getReadyRunes() < 2),
              spell.cast("Rune Strike", ret => me.hasAura(auras.killingMachine)),
              spell.cast("Frost Strike", ret => me.power > 90),
              spell.cast("Howling Blast", ret => me.hasAura(auras.rime)),
              spell.cast("Rune Strike"),
              spell.cast("Horn of Winter", ret => me.targetUnit && me.power < 70 && me.getReadyRunes() <= 4 && this.getSindyCooldown().timeleft > 30000),
              this.useAbomLimb(),
            )
          )
        )
      ),
      // Decorator: Do I NOT have Breath of Sindragosa?
      new bt.Decorator(
        () => (!this.doIKnowSindy()),
        new bt.Selector(
          // Decorator for cooldowns/burst
          new bt.Decorator(
            () => this.wantCooldowns(),
            new bt.Selector(
              this.useAbomLimb(),
              spell.cast("Reaper's Mark", on => me.targetUnit, ret => spell.isSpellKnown("Reaper's Mark") && me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Pillar of Frost", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
              spell.cast("Empower Rune Weapon", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && me.getReadyRunes() < 3 && me.power < 70)
            )
          ),
          spell.cast("Soul Reaper", on => me.target, ret => me.targetUnit.pctHealth < 40 && me.getReadyRunes() > 2),
          spell.cast("Remorseless Winter", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit)),
          this.multiTargetRotation(),
          spell.cast("Rune Strike", ret => me.hasAura(auras.killingMachine)),
          spell.cast("Frost Strike", ret => spell.isSpellKnown('Shattered Frost') && me.targetUnit?.getAura(auras.razorice)?.stacks === 5 || me.getReadyRunes() < 2),
          spell.cast("Glacial Advance", ret => (!spell.isSpellKnown('Shattered Frost')) && me.targetUnit?.getAura(auras.razorice)?.stacks < 5 || me.getReadyRunes() < 2),
          spell.cast("Howling Blast", ret => me.hasAura(auras.rime)),
          spell.cast("Frost Strike", ret => me.power > 45),
          spell.cast("Rune Strike", ret => me.getReadyRunes() >= 2),
          spell.cast("Chains of Ice", on => me.targetUnit, ret => {
            const coldHeart = me.getAura(auras.coldHeart);
            return !!(coldHeart && coldHeart.stacks === 20);
          }),
          spell.cast("Horn of Winter", ret => me.targetUnit && me.power < 70 && me.getReadyRunes() <= 4)
        )
      )
    );
  }

  useAbomLimb() {
    if (Settings.FrostDKUseSmackyHands === true) {
      return spell.cast("Abomination Limb", on => me, ret => me.targetUnit && me.isWithinMeleeRange(me.targetUnit));
    }
    return bt.Status.Failure;
  }

  wantCooldowns() {
    return me.isWithinMeleeRange(me.target) && me.target && Combat.burstToggle;
  }

  multiTargetRotation() {
    return new bt.Selector(
      spell.cast("Frostscythe", on => me, ret => me.getUnitsAroundCount(8) >= 2 && me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && me.isFacing(me.targetUnit) && !me.hasAura(auras.killingMachine)),
      spell.cast("Death and Decay", ret => me.getUnitsAroundCount(10) >= 2 && me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && !me.hasAura(auras.deathAndDecay))
    );
  }

  checkFrostStrikeKeepUpBuffs() {
    if (me.targetUnit && me.isWithinMeleeRange(me.targetUnit)) {
      const icyTalons = me.getAura(auras.icyTalons);
      const unleashedFrenzy = me.getAura(auras.unleashedFrenzy);
      if (icyTalons && unleashedFrenzy && icyTalons.remaining > 2000 && unleashedFrenzy.remaining > 2000) {
        return false;
      }
    }
    return true;
  }

  doIKnowSindy() {
    return spell.isSpellKnown("Breath of Sindragosa");
  }

  getSindyCooldown() {
    return spell.getCooldown("Breath of Sindragosa");
  }

  isSindyActive() {
    return me.hasAura(auras.breathOfSindragosa)
  }

  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Mark of Khardros"),
    );
  }
}
