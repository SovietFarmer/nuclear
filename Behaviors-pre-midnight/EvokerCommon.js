import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

class EvokerCommon {
  static castEmpowered(spellNameOrId, desiredEmpowerLevel, on, conditions) {
    return new bt.Sequence(
      spell.cast(spellNameOrId, () => on(), () => conditions()),
      this.setDesiredEmpowerLevel(desiredEmpowerLevel)
    );
  }

  static setDesiredEmpowerLevel(desiredEmpowerLevel) {
    return new bt.Action(() => {
      this._desiredEmpowerLevel = desiredEmpowerLevel;
      // Store the timestamp when we started empowering
      return bt.Status.Success;
    });
  }

  static handleEmpoweredSpell() {
    if (this._desiredEmpowerLevel !== undefined && me.spellInfo.empowerLevel === this._desiredEmpowerLevel) {
      const currentSpellId = me.spellInfo.spellChannelId;
      const currentSpell = spell.getSpell(currentSpellId);
      if (currentSpell) {
        currentSpell.cast(me.targetUnit);
        this._desiredEmpowerLevel = undefined;
      }
      return bt.Status.Success;
    }
    return bt.Status.Failure;
  }

  static findBestDeepBreathTarget()  {
    return combat.targets.reduce((best, mainUnit) => {
      const unitsInRange = combat.targets.filter(target =>
        target.distanceTo(mainUnit) <= 30 && // Fixed distance check
        me.isFacing(target, 30)
      ).length;

      return unitsInRange > best.count ? { unit: mainUnit, count: unitsInRange } : best;
    }, { unit: null, count: 0 });
  };
  
  // Helper to detect if we're currently empowering a specific spell
  static isEmpowering(spellName) {
    if (!me.isCastingOrChanneling) return false;
    
    const currentSpell = spell.getSpell(me.spellInfo.spellChannelId);
    if (!currentSpell) return false;
    
    return currentSpell.name === spellName;
  }
}

export default EvokerCommon;