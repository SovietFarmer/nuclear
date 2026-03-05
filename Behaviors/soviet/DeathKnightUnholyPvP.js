import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Pet from "@/Core/Pet";
import Spell from "@/Core/Spell";
import { RaceType } from "@/Enums/UnitEnums";

const auras = {
  darkSuccor: 101568,
  chainsOfIce: 45524,
  festeringWound: 194310,
  deathAndDecay: 188290,
  suddenDoom: 81340,
  plagueBringer: 390178,
  frostFever: 55095,
  bloodPlague: 55078,
  virulentPlague: 191587,
  deathRot: 377540,
  trollbaneChainsOfIce: 444826,
  festeringScythe: 458123,
  legionOfSouls: 383269,
  rottenTouch: 390275,
  darkTransform: 63560,
  unholyAssault: 207289,
}

export class DeathKnightUnholy extends Behavior {
  name = "Death Knight (Unholy) PvP";
  context = BehaviorContext.Any; // PvP or PvE
  specialization = Specialization.DeathKnight.Unholy

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      new bt.Decorator(
        ret => me.pet && me.pet.hasVisibleAura(auras.darkTransform),
        spell.interrupt("Leap", true)
      ),
      spell.interrupt("Gnaw", true),
      common.waitForFacing(),
      spell.cast("Raise Dead", on => me, req => !Pet.current),
      spell.interrupt("Mind Freeze", true),
      spell.cast("Claw", on => me.target),
      spell.cast("Strangulate", on => this.strangulateTarget(), ret => me.target && me.target.pctHealth < 70 && this.strangulateTarget() !== undefined),
      spell.cast("Blinding Sleet", on => this.blindingSleetTarget(), ret => this.blindingSleetTarget() !== undefined),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotWaitingForArenaToStart(),
          common.waitForNotSitting(),
          common.waitForNotMounted(),
          common.waitForCastOrChannel(),
          spell.cast("Death Strike", ret => me.pctHealth < 95 && me.hasAura(auras.darkSuccor)),
          spell.cast("Death Strike", ret => me.pctHealth < 55 && (Spell.getTimeSinceLastCast("Death Strike") > 3000 || me.power > 50)),
          new bt.Decorator(
            ret => Combat.burstToggle && me.target && me.isWithinMeleeRange(me.target),
            this.burstDamage()
          ),
          this.sustainedDamage(),
        )
      )
    );
  }

  // Burst Damage Rotation
  burstDamage() {
    return new bt.Selector(
      // Major cooldowns first
      spell.cast("Army of the Dead", ret => true),
      spell.cast("Summon Gargoyle", ret => true),
      spell.cast("Unholy Assault", ret => true),
      this.useRacials(),

      // Core burst rotation
      // Use Apocalypse - spend 4 wounds and transform pet
      spell.cast("Apocalypse", on => me.target, ret => me.target && me.targetUnit.getAuraStacks(auras.festeringWound) >= 2),

      // Priority: Use Rune Strike to build wounds when Apocalypse is off cooldown but we don't have enough wounds
      spell.cast("Rune Strike", on => me.target, ret => me.target &&
        me.targetUnit.getAuraStacks(auras.festeringWound) <= 4 &&
        !spell.isOnCooldown("Apocalypse")),

      // Use Scourge Strike to spend wounds
      spell.cast("Scourge Strike", on => me.target, ret => me.target && me.targetUnit.getAuraStacks(auras.festeringWound) > 2),

      // Use Death Coil if high Runic Power or Sudden Doom proc with 3+ wounds
      spell.cast("Death Coil", on => me.target, ret => me.target &&
        (me.power > 80 || (me.hasAura(auras.suddenDoom) && me.targetUnit.getAuraStacks(auras.festeringWound) >= 3))),

      // Maintain Virulent Plague
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),

      // Use Rune Strike to reapply wounds when 1-4 remaining (fallback)
      spell.cast("Rune Strike", on => me.target, ret => me.target && me.targetUnit.getAuraStacks(auras.festeringWound) <= 4),

      // Death and Decay for area control
      spell.cast("Death and Decay", on => me, ret => this.shouldDeathAndDecay()),

      // Fallback Death Coil
      spell.cast("Death Coil", on => me.target, ret => me.target && me.power > 60)
    );
  }

  // New Sustained Damage Rotation
  sustainedDamage() {
    return new bt.Selector(
      // Maintain Virulent Plague on as many targets as possible
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),

      // Use Rune Strike to generate and refresh Festering Wounds
      spell.cast("Rune Strike", on => me.target, ret => me.target && me.targetUnit.getAuraStacks(auras.festeringWound) <= 3),

      // Use Scourge Strike to spend wounds and maintain plaguebringer
      spell.cast("Scourge Strike", on => me.target, ret => me.target && me.targetUnit.getAuraStacks(auras.festeringWound) > 1),

      // Use Death Coil if high Runic Power or Sudden Doom proc
      spell.cast("Death Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),

      // Death and Decay for area control
      spell.cast("Death and Decay", ret => this.shouldDeathAndDecay()),

      // Fallback Death Coil
      spell.cast("Death Coil", on => me.target, ret => me.target && me.power > 60)
    );
  }

  shouldDeathAndDecay() {
    return me.targetUnit && me.isWithinMeleeRange(me.targetUnit) && !me.hasAura(auras.deathAndDecay)
  }

  strangulateTarget() {
    // Get all enemy players within 20 yards and find the first valid healer target
    const nearbyEnemies = me.getPlayerEnemies(20);

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && !unit.isCCd() && unit.canCC() && unit.getDR("silence") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  blindingSleetTarget() {
    // Get all enemy players within 10 yards
    const nearbyEnemies = me.getPlayerEnemies(10);

    for (const unit of nearbyEnemies) {
      if (unit !== me.target &&
        me.isFacing(unit) &&
        unit.isHealer() &&
        !unit.isCCd() &&
        unit.canCC() &&
        unit.getDR("disorient") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  // Racial abilities
  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, ret => me.race === RaceType.Orc && me.hasAura(auras.unholyAssault)),
    );
  }
}
