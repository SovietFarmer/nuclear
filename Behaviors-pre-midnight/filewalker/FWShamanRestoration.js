import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from '@/Targeting/HealTargeting';
import Settings from "@/Core/Settings";

/**
 * Restoration Shaman behavior
 * Based on latest Dragonflight patch rotations and priorities
 * 
 * Hero Talents detected automatically:
 * - Call of the Ancestors (Farseer)
 * - Surging Totem (Totemic)
 */
export class ShamanRestorationBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Restoration;
  name = "FW Restoration Shaman";
  version = 1;
  
  // Define talent build options - will detect hero talent automatically
  static TALENT_BUILDS = {
    FARSEER: 'farseer',
    TOTEMIC: 'totemic'
  };
  
  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Restoration Shaman Configuration",
      options: [
        {
          uid: "HealThreshold",
          text: "Healing Surge Health Threshold",
          type: "slider",
          min: 1,
          max: 100,
          default: 65
        },
        {
          uid: "RiptidePriority",
          text: "Keep Riptide on multiple targets",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseEarthShield",
          text: "Maintain Earth Shield on tank",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseUnleashLife",
          text: "Use Unleash Life",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseHealingTideTotem",
          text: "Use Healing Tide Totem",
          type: "checkbox",
          default: true
        },
        {
          uid: "HealingTideTotemThreshold",
          text: "Healing Tide Totem Group Health Threshold",
          type: "slider",
          min: 1,
          max: 100,
          default: 60
        },
        {
          uid: "UseSpiritLinkTotem",
          text: "Use Spirit Link Totem",
          type: "checkbox",
          default: true
        },
        {
          uid: "SpiritLinkTotemThreshold",
          text: "Spirit Link Totem Group Health Threshold",
          type: "slider",
          min: 1,
          max: 100,
          default: 50
        },
        {
          uid: "UseAscendance",
          text: "Use Ascendance",
          type: "checkbox",
          default: true
        },
        {
          uid: "AscendanceThreshold",
          text: "Ascendance Group Health Threshold",
          type: "slider",
          min: 1,
          max: 100,
          default: 45
        }
      ]
    }
  ];

  /**
   * Builds the behavior tree for this specialization
   * This is the main entry point for the behavior
   * @returns {bt.Composite} The root node of the behavior tree
   */
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      this.ensureBuffs(),
      this.emergencyHealing(),
      this.cooldowns(),
      this.totems(),
      this.core_rotation()
    );
  }

  /**
   * Ensure essential buffs are maintained
   */
  ensureBuffs() {
    return new bt.Selector(
      // Water Shield
      Spell.cast("Water Shield", () => !me.hasAura(52127)),
      
      // Earthliving Weapon
      Spell.cast("Earthliving Weapon", () => !me.hasAura(382021)),
      
      // Tidecaller's Guard (if talented)
      Spell.cast("Tidecaller's Guard", () => this.hasTalent("supportive_imbuements") && !me.hasAura(457493))
    );
  }

  /**
   * Emergency healing rotation
   */
  emergencyHealing() {
    return new bt.Selector(
      // Nature's Swiftness + Healing Surge for emergency healing
      new bt.Sequence(
        new bt.Action(() => {
          const lowestAlly = heal.getPriorityTarget();
          if (!lowestAlly || lowestAlly.health > lowestAlly.maxHealth * 0.4) return bt.Status.Failure;
          return bt.Status.Success;
        }),
        Spell.cast("Nature's Swiftness"),
        Spell.cast("Healing Surge", () => heal.getPriorityTarget())
      ),
      
      // Ascendance when multiple allies are low health
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.UseAscendance) return bt.Status.Failure;
          
          const threshold = Settings.AscendanceThreshold / 100;
          const lowHealthCount = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * threshold
          ).length;
          
          return lowHealthCount >= 3 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Ascendance")
      )
    );
  }

  /**
   * Use cooldowns based on healing requirements
   */
  cooldowns() {
    return new bt.Selector(
      // Healing Tide Totem when group is taking heavy damage
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.UseHealingTideTotem) return bt.Status.Failure;
          
          const threshold = Settings.HealingTideTotemThreshold / 100;
          const lowHealthCount = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * threshold
          ).length;
          
          return lowHealthCount >= 3 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Healing Tide Totem")
      ),
      
      // Spirit Link Totem when health is very uneven
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.UseSpiritLinkTotem) return bt.Status.Failure;
          
          const threshold = Settings.SpiritLinkTotemThreshold / 100;
          const lowHealthCount = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * threshold
          ).length;
          
          return lowHealthCount >= 3 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Spirit Link Totem")
      ),
      
      // Unleash Life before other heals when available
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.UseUnleashLife) return bt.Status.Failure;
          
          const target = heal.getPriorityTarget();
          return target && target.health < target.maxHealth * 0.8 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Unleash Life", () => heal.getPriorityTarget())
      )
    );
  }

  /**
   * Setup and maintain totems
   */
  totems() {
    return new bt.Selector(
      // Earth Shield on tank if enabled
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.UseEarthShield) return bt.Status.Failure;
          
          const tank = heal.friends.Tanks[0];
          if (!tank) return bt.Status.Failure;
          
          return !tank.hasAura(974) && !tank.hasAura(383648) ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Earth Shield", () => heal.friends.Tanks[0])
      ),
      
      // Cloudburst Totem (if talented)
      new bt.Sequence(
        new bt.Action(() => {
          if (!this.hasTalent("cloudburst_totem")) return bt.Status.Failure;
          if (me.hasAura(157504)) return bt.Status.Failure; // Already active
          
          // Check if there is ongoing damage
          const anyDamageTaken = heal.priorityList.some(unit => 
            unit.health < unit.maxHealth * 0.9
          );
          
          return anyDamageTaken ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Cloudburst Totem")
      ),
      
      // Healing Stream Totem
      new bt.Sequence(
        new bt.Action(() => {
          if (this.hasTalent("cloudburst_totem")) return bt.Status.Failure; // Use Cloudburst instead
          
          const anyInjured = heal.priorityList.some(unit => 
            unit.health < unit.maxHealth * 0.95
          );
          
          return anyInjured ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Healing Stream Totem")
      ),
      
      // Earthen Wall Totem during heavy damage
      new bt.Sequence(
        new bt.Action(() => {
          if (!this.hasTalent("earthen_wall_totem")) return bt.Status.Failure;
          
          const heavyDamage = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.7
          ).length >= 2;
          
          return heavyDamage ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Earthen Wall Totem")
      )
    );
  }

  /**
   * Core healing rotation
   */
  core_rotation() {
    return new bt.Selector(
      // Maintain Riptide on multiple targets
      new bt.Sequence(
        new bt.Action(() => {
          if (!Settings.RiptidePriority) return bt.Status.Failure;
          
          // Find targets without Riptide
          const targets = heal.priorityList.filter(unit => 
            !unit.hasAura(61295) && unit.health < unit.maxHealth * 0.97
          );
          
          return targets.length > 0 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Riptide", () => {
          // Find first target without Riptide
          return heal.priorityList.find(unit => !unit.hasAura(61295));
        })
      ),
      
      // Primordial Wave if talented 
      new bt.Sequence(
        new bt.Action(() => {
          if (!this.hasTalent("primordial_wave")) return bt.Status.Failure;
          
          const target = heal.getPriorityTarget();
          return target && target.health < target.maxHealth * 0.8 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Primordial Wave", () => heal.getPriorityTarget())
      ),
      
      // Surging Totem if talented (Totemic hero talent)
      new bt.Sequence(
        new bt.Action(() => {
          if (!this.isTotemic()) return bt.Status.Failure;
          
          const groupDamaged = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.85
          ).length >= 3;
          
          return groupDamaged ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Surging Totem")
      ),
      
      // Downpour if available
      new bt.Sequence(
        new bt.Action(() => {
          if (!me.hasAura(462488)) return bt.Status.Failure; // Downpour buff
          
          const groupDamaged = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.8
          ).length >= 3;
          
          return groupDamaged ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Downpour")
      ),
      
      // Healing Rain
      new bt.Sequence(
        new bt.Action(() => {
          if (this.isTotemic()) return bt.Status.Failure; // Use Surging Totem instead
          
          const groupDamaged = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.9
          ).length >= 3;
          
          return groupDamaged ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Healing Rain")
      ),

      // Chain Heal for group healing with High Tide
      new bt.Sequence(
        new bt.Action(() => {
          const groupDamaged = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.85
          ).length >= 3;
          
          // Check for High Tide or Tidebringer procs
          const hasHighTide = me.hasAura(288675);
          const hasTidebringer = me.hasAura(236502);
          
          return (groupDamaged && (hasHighTide || hasTidebringer)) ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Chain Heal", () => heal.getPriorityTarget())
      ),
      
      // Wellspring if talented
      new bt.Sequence(
        new bt.Action(() => {
          if (!this.hasTalent("wellspring")) return bt.Status.Failure;
          
          const groupDamaged = heal.priorityList.filter(unit => 
            unit.health < unit.maxHealth * 0.85
          ).length >= 3;
          
          return groupDamaged ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Wellspring")
      ),
      
      // Healing Surge for low health targets
      new bt.Sequence(
        new bt.Action(() => {
          const target = heal.getPriorityTarget();
          const threshold = Settings.HealThreshold / 100;
          
          return target && target.health < target.maxHealth * threshold ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Healing Surge", () => heal.getPriorityTarget())
      ),
      
      // Healing Wave for efficient healing
      new bt.Sequence(
        new bt.Action(() => {
          const target = heal.getPriorityTarget();
          return target && target.health < target.maxHealth * 0.9 ? bt.Status.Success : bt.Status.Failure;
        }),
        Spell.cast("Healing Wave", () => heal.getPriorityTarget())
      ),
      
      // Default to Riptide if nothing else to do
      Spell.cast("Riptide", () => heal.getPriorityTarget())
    );
  }

  /**
   * Check if a talent is active
   * @param {string} talentName The name of the talent to check
   * @returns {boolean} True if the talent is active
   */
  hasTalent(talentName) {
    return Spell.isSpellKnown(talentName);
  }

  /**
   * Check if the Farseer hero talent is active
   * @returns {boolean} True if Farseer is active
   */
  isFarseer() {
    // Check for Call of the Ancestors - key talent for Farseer
    return me.hasAura(443450) || Spell.isSpellKnown("Call of the Ancestors");
  }

  /**
   * Check if the Totemic hero talent is active
   * @returns {boolean} True if Totemic is active
   */
  isTotemic() {
    // Check for Surging Totem - key talent for Totemic
    return me.hasAura(444995) || Spell.isSpellKnown("Surging Totem");
  }

  /**
   * Auto-detect which talent build is active based on key talents
   * @returns {string} The detected talent build
   */
  autoDetectBuild() {
    if (this.isFarseer()) {
      return ShamanRestorationBehavior.TALENT_BUILDS.FARSEER;
    } else if (this.isTotemic()) {
      return ShamanRestorationBehavior.TALENT_BUILDS.TOTEMIC;
    }
    
    // Default if detection fails
    return ShamanRestorationBehavior.TALENT_BUILDS.FARSEER;
  }
}