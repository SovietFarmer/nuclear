import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import KeyBinding from "@/Core/KeyBinding";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import objMgr from "@/Core/ObjectManager";

const auras = {
  // Buffs
  lifebloom: 33763,
  lifebloomResto: 1227806, // Midnight Resto-specific Lifebloom ID
  rejuvenation: 774,
  rejuvenationGermination: 155777,
  regrowth: 8936,
  wildGrowth: 48438,
  efflorescence: 81262,
  efflorescenceAura: 145205, // Visible aura when Efflorescence is active
  omenOfClarity: 16870,
  clearcasting: 16870,
  soulOfTheForest: 114108,
  abundance: 207383,
  natureSwiftness: 132158,
  innervate: 29166,

  // Debuffs
  sunfire: 164815,
  moonfire: 164812,

  // Talents/Procs
  photosynthesis: 274902,
  verdantInfusion: 392410,
  rampantGrowth: 404521,

  // Forms
  catForm: 768,
  bearForm: 5487,
  travelForm: 783,
  prowl: 5215,

  // Cat abilities
  rake: 155722,
  rip: 1079,
  thrash: 106832,

  // Mastery
  harmony: 77495,

  // Utility buffs
  markOfTheWild: 1126,
  symbioticRelationship: 474750,

  // Defensive abilities
  barkskin: 22812,

  // Emergency abilities
  renewal: 108238,
  tranquility: 740,
  revitalize: 212040,

  // Interrupts
  incapacitatingRoar: 99,
  mightyBash: 5211,

  // Talent checks
  fluidForm: 449193,
  heartOfTheWild: 319454,
  naturesVigil: 124974,

  // Midnight talents
  everbloom: "Everbloom",
  lifetreading: 1217941
};

export class JmrRestoDruidBehavior extends Behavior {
  name = "Jmr Resto Druid";
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Restoration;
  version = 1;

  // Runtime toggles for overlay
  overlayToggles = {
    showOverlay: new imgui.MutableVariable(true),
    healing: new imgui.MutableVariable(true),
    cooldowns: new imgui.MutableVariable(true),
    dps: new imgui.MutableVariable(true),
    interrupts: new imgui.MutableVariable(true)
  };

  // Ramp system state
  rampModeActive = false;
  rampStartTime = 0;
  rampToggleTime = 0;
  lastRampTextError = 0;
  lastEfflorescenceCheck = 0;
  // Burst system state
  burstModeActive = false;
  burstToggleTime = 0;

  constructor() {
    super();
    // Initialize the ramp keybinding with default F1
    KeyBinding.setDefault("RampKeybind", imgui.Key.F1);
    // Initialize the burst toggle keybinding with default X
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.X);
  }

  // Manual spell casting
  spellIdInput = new imgui.MutableVariable("8936"); // Default to Regrowth

  // Combo point tracking
  lastComboGeneratorTime = 0;
  lastComboGeneratorSpell = null;

  // Form shift and ability timing
  lastFormShiftTime = 0;
  lastEfflorescenceIneffectiveTime = 0;
  lastEfflorescenceState = null; // Track if last check had active/populated Efflorescence
  lastCatFormEntryTime = 0; // Track when we entered cat form
  lastEmergencyHealingTime = 0; // Track when we last did emergency healing

  static settings = [
    {
      header: "Ramp System",
      options: [
        { type: "checkbox", uid: "UseRampSystem", text: "Enable Ramp System", default: true },
        { type: "hotkey", uid: "RampKeybind", text: "Ramp Key", default: imgui.Key.F1 },
        { type: "slider", uid: "RampDuration", text: "Ramp Cycle Duration (seconds)", min: 3, max: 15, default: 15 },
        { type: "slider", uid: "RampEmergencyExitPct", text: "Emergency Exit Health %", min: 30, max: 95, default: 90 },
        { type: "slider", uid: "RampEmergencyExitCount", text: "Emergency Exit Friend Count", min: 1, max: 5, default: 3 },
        { type: "checkbox", uid: "ShowRampText", text: "Show Ramp Text at Character", default: true }
      ]
    },
    {
      header: "Healing Settings",
      options: [
        { type: "slider", uid: "RegrowthHealthPct", text: "Regrowth Health %", min: 0, max: 95, default: 75 },
        { type: "slider", uid: "RegrowthEmergencyPct", text: "Regrowth Emergency %", min: 0, max: 95, default: 50 },
        { type: "slider", uid: "RejuvenationHealthPct", text: "Rejuvenation Health %", min: 0, max: 100, default: 90 },
        { type: "slider", uid: "WildGrowthHealthPct", text: "Wild Growth Health %", min: 0, max: 100, default: 95 },
        { type: "slider", uid: "WildGrowthMinTargets", text: "Wild Growth Min Targets", min: 1, max: 5, default: 3 },
        { type: "checkbox", uid: "UseWildGrowthHealing", text: "Use Wild Growth for Normal Healing", default: true },
        { type: "slider", uid: "WildGrowthHealingHealthPct", text: "Wild Growth Healing Health %", min: 0, max: 100, default: 90 },
        { type: "slider", uid: "WildGrowthHealingMinTargets", text: "Wild Growth Healing Min Targets", min: 1, max: 5, default: 3 },
        { type: "slider", uid: "SwiftmendHealthPct", text: "Swiftmend Health %", min: 0, max: 100, default: 90 },
        { type: "checkbox", uid: "UseNatureSwiftness", text: "Use Nature's Swiftness", default: true },
        { type: "slider", uid: "NatureSwiftnessHealthPct", text: "Nature's Swiftness Health %", min: 0, max: 90, default: 50 }
      ]
    },
    {
      header: "HoT Management",
      options: [
        { type: "checkbox", uid: "MaintainLifebloom", text: "Maintain Lifebloom (always on tank)", default: true },
        { type: "checkbox", uid: "UseLifebloomHealing", text: "Use Lifebloom for Normal Healing", default: true },
        { type: "slider", uid: "LifebloomHealingHealthPct", text: "Lifebloom Healing Health %", min: 0, max: 95, default: 90 },
        { type: "checkbox", uid: "MaintainEfflorescence", text: "Maintain Efflorescence (manual, auto-skipped with Lifetreading)", default: true },
        { type: "slider", uid: "EfflorescenceMinTargets", text: "Efflorescence Min Targets", min: 1, max: 5, default: 2 },
        { type: "checkbox", uid: "SpreadRejuvenation", text: "Use Rejuvenation for Normal Healing", default: true },
        { type: "checkbox", uid: "MaintainMarkOfTheWild", text: "Maintain Mark of the Wild", default: true }
      ]
    },
    {
      header: "Cooldowns & Utilities",
      options: [
        { type: "checkbox", uid: "UseConvoke", text: "Use Convoke the Spirits (Healing)", default: true },
        { type: "slider", uid: "ConvokeHealthPct", text: "Convoke Health %", min: 0, max: 90, default: 70 },
        { type: "slider", uid: "ConvokeMinTargets", text: "Convoke Min Targets", min: 1, max: 5, default: 3 },
        { type: "checkbox", uid: "UseIncarnation", text: "Use Incarnation: Tree of Life", default: false },
        { type: "slider", uid: "IncarnationHealthPct", text: "Incarnation Health %", min: 0, max: 95, default: 80 },
        { type: "slider", uid: "IncarnationMinTargets", text: "Incarnation Min Targets", min: 1, max: 5, default: 3 },
        { type: "checkbox", uid: "UseInnervate", text: "Use Innervate", default: true },
        { type: "slider", uid: "InnervateManaPercent", text: "Innervate Mana %", min: 0, max: 95, default: 85 },
        { type: "checkbox", uid: "UseIronbark", text: "Use Ironbark", default: true },
        { type: "slider", uid: "IronbarkHealthPct", text: "Ironbark Health %", min: 0, max: 95, default: 65 },
        { type: "checkbox", uid: "UseBarkskin", text: "Use Barkskin", default: true },
        { type: "slider", uid: "BarkskinHealthPct", text: "Barkskin Health %", min: 0, max: 80, default: 55 },
        { type: "checkbox", uid: "UseRenewal", text: "Use Renewal", default: true },
        { type: "slider", uid: "RenewalHealthPct", text: "Renewal Health %", min: 0, max: 60, default: 30 },
        { type: "checkbox", uid: "UseTranquility", text: "Use Tranquility", default: true },
        { type: "slider", uid: "TranquilityHealthPct", text: "Tranquility Health %", min: 30, max: 100, default: 60 },
        { type: "slider", uid: "TranquilityMinTargets", text: "Tranquility Min Targets", min: 2, max: 5, default: 3 },
        { type: "checkbox", uid: "UseEfflorescence", text: "Use Efflorescence", default: true },
        { type: "slider", uid: "EfflorescenceDelay", text: "Efflorescence Cast Delay (ms)", min: 0, max: 10000, default: 5000 },
        { type: "checkbox", uid: "UseRevitalize", text: "Use Revitalize (Mass Resurrection)", default: true },
        { type: "checkbox", uid: "UseSymbioticRelationship", text: "Use Symbiotic Relationship", default: true }
      ]
    },
    {
      header: "DPS Settings",
      options: [
        { type: "checkbox", uid: "EnableDPS", text: "Enable DPS", default: true },
        { type: "checkbox", uid: "MaintainSunfire", text: "Maintain Sunfire", default: true },
        { type: "slider", uid: "SunfireMinTTD", text: "Sunfire Min Time to Death (seconds)", min: 3, max: 30, default: 8 },
        { type: "checkbox", uid: "MaintainMoonfire", text: "Maintain Moonfire", default: false },
        { type: "slider", uid: "MoonfireMinTTD", text: "Moonfire Min Time to Death (seconds)", min: 5, max: 60, default: 15 },
        { type: "checkbox", uid: "UseCatWeaving", text: "Use Cat Weaving", default: true },
        { type: "checkbox", uid: "RespectRakeTTD", text: "Respect Rake Time to Death", default: true },
        { type: "slider", uid: "RakeMinTTD", text: "Rake Min Time to Death (seconds)", min: 3, max: 30, default: 6 },
        { type: "checkbox", uid: "RespectRipTTD", text: "Respect Rip Time to Death", default: true },
        { type: "slider", uid: "RipMinTTD", text: "Rip Min Time to Death (seconds)", min: 5, max: 60, default: 12 },
        { type: "slider", uid: "CatWeavingHealthPct", text: "Cat Weaving Health Threshold %", min: 0, max: 100, default: 68 },
        { type: "slider", uid: "CatFormEnergyThreshold", text: "Cat Form Exit Energy Threshold", min: 0, max: 100, default: 8 },
        { type: "slider", uid: "CatFormEntryEnergyThreshold", text: "Cat Form Entry Energy Threshold", min: 0, max: 100, default: 60 },
        { type: "slider", uid: "FormShiftDelay", text: "Form Shift Delay (ms)", min: 0, max: 10000, default: 2000 },
        { type: "slider", uid: "MinCatFormDuration", text: "Min Cat Form Duration (ms)", min: 0, max: 10000, default: 4500 },
        { type: "slider", uid: "EmergencyHealingCooldown", text: "Emergency Healing Cooldown (ms)", min: 0, max: 15000, default: 8000 },
        //{ type: "slider", uid: "ShredEnergyThreshold", text: "Shred Energy Threshold", min: 0, max: 100, default: 50 },
        { type: "checkbox", uid: "CatWeavingDebug", text: "Cat Weaving Debug", default: false },
        { type: "checkbox", uid: "UseHeartOfTheWild", text: "Use Heart of the Wild (DPS)", default: true },
        { type: "checkbox", uid: "UseConvokeForDPS", text: "Use Convoke the Spirits (DPS)", default: true },
        { type: "checkbox", uid: "UseProwl", text: "Use Prowl (Out of Combat)", default: true },
        { type: "checkbox", uid: "UseNaturesVigil", text: "Use Nature's Vigil (DPS)", default: true }
      ]
    },
    {
      header: "Burst Toggle System",
      options: [
        { type: "checkbox", uid: "UseBurstToggle", text: "Use Burst Toggle", default: true },
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.X },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 }
      ]
    },
    {
      header: "Interrupts & Dispels",
      options: [
        { type: "checkbox", uid: "UseNaturesCure", text: "Use Nature's Cure (Dispel)", default: true },
        { type: "checkbox", uid: "UseIncapacitatingRoar", text: "Use Incapacitating Roar (AoE Interrupt)", default: true },
        { type: "checkbox", uid: "UseMightyBash", text: "Use Mighty Bash (Interrupt)", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector("JmrRestoDruid",
      new bt.Action(() => {
        this.renderOverlay();

        // Show ramp text at character position
        if (Settings.ShowRampText && this.rampModeActive && this.rampStartTime > 0 && me && me.position) {
          try {
            const elapsed = (wow.frameTime - this.rampStartTime) / 1000;
            const remaining = Math.max(0, Settings.RampDuration - elapsed);
            const rampText = `RAMP ACTIVE: ${remaining.toFixed(1)}s`;

            // Validate all parameters before calling addText
            if (rampText && typeof rampText === 'string' && rampText.length > 0) {
              // Convert world position to screen position and add text
              const screenPos = wow.WorldFrame.getScreenCoordinates(me.position);
              if (screenPos && typeof screenPos.x === 'number' && typeof screenPos.y === 'number' &&
                  screenPos.x !== -1 && screenPos.y !== -1) {
                // Position text slightly above character
                const textPos = { x: Math.floor(screenPos.x), y: Math.floor(screenPos.y - 30) };
                const drawList = imgui.getBackgroundDrawList();
                if (drawList && typeof drawList.addText === 'function') {
                  drawList.addText(rampText, textPos, 0xFF00FF00, null, 14);
                }
              }
            }
          } catch (error) {
            // Only log once per second to avoid spam
            if (!this.lastRampTextError || (wow.frameTime - this.lastRampTextError) > 1000) {
              console.warn(`[RestoDruid] Ramp text error: ${error.message}`);
              this.lastRampTextError = wow.frameTime;
            }
          }
        }

        // Manual spell casting with RightArrow
        if (imgui.isKeyPressed(imgui.Key.RightArrow)) {
          const target = me.targetUnit || this.getLowestHealthAlly() || me;
          const spellId = parseInt(this.spellIdInput.value, 10);
          const spellObject = spell.getSpell(spellId);

          if (spellObject) {
            const spellName = spellObject.name || "Unknown Spell";
            spell.castPrimitive(spellObject, target);
          } else {
            // Spell not found - silently ignore
          }
        }

        // Handle ramp system
        this.handleRampSystem();

        // Handle burst system
        this.handleBurstToggle();

        return bt.Status.Failure; // Always continue to the rest of the rotation
      }),

      // Cancel forms if target is too far away in combat
      new bt.Decorator(
        () => me.inCombat() && me.target && me.canAttack(me.target) && !me.target.isImmune() &&
              me.distanceTo(me.target) > 8 &&
              !me.hasAuraByMe(432031) &&
              (me.hasAuraByMe(auras.catForm) || me.hasAuraByMe(auras.bearForm)),
        new bt.Action(() => {
          this.cancelCurrentForm();
          return bt.Status.Success;
        }),
        "Cancel Forms"
      ),

      new bt.Decorator(
        () => me.hasAuraByMe(auras.catForm) && !me.inCombat() && !me.hasAuraByMe(auras.prowl) && spell.getCooldown(5215).ready && !me.isCastingOrChanneling,
        new bt.Action(() => {
          const prowlSpell = spell.getSpell(5215);
          if (prowlSpell && this.getCurrentTarget() === null) {
            return spell.castPrimitive(prowlSpell, me) ? bt.Status.Success : bt.Status.Failure;
          }
          return bt.Status.Failure;
        }),
        "Prowl"
      ),
      common.waitForNotMounted(),
      common.waitForNotSitting(),

      new bt.Decorator(
        () => me.inCombat(),
        new bt.Action(() => {
            const rebirth = spell.getSpell(20484);
            const deadfriend = this.mouseoverIsDeadFriend();
            const mouseoverGuid = wow.GameUI.mouseOverGuid;
            if (rebirth && deadfriend && mouseoverGuid && !mouseoverGuid.isNull) {
                try {
                    const mouseoverUnit = mouseoverGuid.toUnit();
                    if (mouseoverUnit && mouseoverUnit.deadOrGhost) {
                        return spell.castPrimitive(rebirth, mouseoverUnit) ? bt.Status.Success : bt.Status.Failure;
                    }
                } catch (error) {
                    // Invalid guid, skip rebirth
                    return bt.Status.Failure;
                }
            }
            return bt.Status.Failure;
        }),
        "Rebirth Mouseover"
      ),


      common.waitForCastOrChannel(),
              // Main rotation
        new bt.Selector("Main Rotation",
          // Revitalize (mass resurrection) - out of combat only
          spell.cast("Revitalize", () =>
            Settings.UseRevitalize &&
            !me.inCombat() &&
            this.getDeadAlliesInRange(40).length > 0
          ),

          // Symbiotic Relationship maintenance
          spell.cast("Symbiotic Relationship", on => this.getSymbioticRelationshipTarget(), req =>
            Settings.UseSymbioticRelationship &&
            this.getSymbioticRelationshipTarget() !== null &&
            !me.hasAuraByMe(474754) &&
            me.getFriends(40).length > 2 &&
            !spell.getLastSuccessfulSpells(2).find(spell => spell.name === "Symbiotic Relationship") &&
            !this.getSymbioticRelationshipTarget().inCombat() &&
            !me.inCombat()
          ),

          // Mark of the Wild maintenance (high priority utility)
          spell.cast("Mark of the Wild", on => this.getMarkOfTheWildTarget(), req =>
            Settings.MaintainMarkOfTheWild &&
            this.getMarkOfTheWildTarget() !== null &&
            spell.getTimeSinceLastCast("Mark of the Wild") > 10000
          ),

        // Nature's Cure for dispels (Magic, Curse, Poison on friends)
        new bt.Decorator(
          () => Settings.UseNaturesCure && spell.isSpellKnown("Nature's Cure"),
          spell.dispel("Nature's Cure", true, DispelPriority.Low, true, WoWDispelType.Magic, WoWDispelType.Curse, WoWDispelType.Poison)
        ),
        // Nature's Cure for specific mythic debuffs (high priority override)
        spell.cast("Nature's Cure", on => this.findFriendWithMythicDebuff(), req =>
            Settings.UseNaturesCure &&
            spell.isSpellKnown("Nature's Cure") &&
            this.findFriendWithMythicDebuff() !== null
        ),
        spell.dispel("Soothe", false, DispelPriority.Low, false, WoWDispelType.Enrage),

          // Emergency healing (highest priority)
          new bt.Decorator(
            () => this.overlayToggles.healing.value,
            this.buildEmergencyHealing(),
            "Emergency Healing"
          ),

        // Ramp mode rotation
        new bt.Decorator(
          () => this.rampModeActive,
          this.buildRampRotation(),
          "Ramp Mode"
        ),

        // Interrupts and dispels
        new bt.Decorator(
          () => this.overlayToggles.interrupts.value,
          this.buildInterrupts(),
          "Interrupts"
        ),

        // Cooldowns
        new bt.Decorator(
          () => this.overlayToggles.cooldowns.value,
          this.buildCooldowns(),
          "Cooldowns"
        ),

        // Normal healing rotation
        new bt.Decorator(
          () => this.overlayToggles.healing.value,
          this.buildHealingRotation(),
          "Healing"
        ),

        // DPS rotation
        new bt.Decorator(
          () => this.overlayToggles.dps.value && Settings.EnableDPS,
          this.buildDPSRotation(),
          "DPS"
        )
      )
    );
  }

  // Helper function to cancel current form aura
  cancelCurrentForm() {
    if (me.hasAuraByMe(auras.catForm)) {
      const catFormAura = me.getAura(auras.catForm);
      if (catFormAura) {
        me.cancelAura(catFormAura.spellId);
        return true;
      }
    } else if (me.hasAuraByMe(auras.bearForm)) {
      const bearFormAura = me.getAura(auras.bearForm);
      if (bearFormAura) {
        me.cancelAura(bearFormAura.spellId);
        return true;
      }
    }
    return false;
  }

  buildEmergencyHealing() {
    return new bt.Selector(
      // Tranquility for group emergency
      spell.cast("Tranquility", () =>
        Settings.UseTranquility &&
        this.getFriendsUnderHealthPercent(Settings.TranquilityHealthPct).length >= Settings.TranquilityMinTargets
      ),

      // Renewal for self emergency
      spell.cast("Renewal", () =>
        Settings.UseRenewal &&
        me.effectiveHealthPercent <= Settings.RenewalHealthPct
      ),

      // Barkskin for self damage reduction
      spell.cast("Barkskin", () =>
        Settings.UseBarkskin &&
        me.effectiveHealthPercent <= Settings.BarkskinHealthPct &&
        !me.hasAuraByMe(auras.barkskin) &&
        !me.hasAuraByMe(102342) &&
        me.inCombat()
      ),

      // Nature's Swiftness + Regrowth for critical health
      spell.cast("Nature's Swiftness", () =>
        Settings.UseNatureSwiftness &&
        this.getCriticalHealthAlly() !== null &&
        !me.hasAura(auras.natureSwiftness)
      ),

      // Regrowth with Nature's Swiftness
      spell.cast("Regrowth", on => this.getCriticalHealthAlly(), req =>
        this.getCriticalHealthAlly() !== null &&
        me.hasAura(auras.natureSwiftness)
      ),

      // Emergency Regrowth without Nature's Swiftness
      spell.cast("Regrowth", on => this.getCriticalHealthAlly(), req =>
        this.getCriticalHealthAlly() !== null
      ),

      // Swiftmend for emergency healing
      spell.cast("Swiftmend", on => this.getSwiftmendTarget(), req =>
        this.getSwiftmendTarget() !== null
      ),

      this.buildHealingRotation()
    );
  }

  buildRampRotation() {
    return new bt.Selector(
       // Cancel any form when ramp is active (unless form-locked)
       new bt.Action(() => {
         if (!me.hasAuraByMe(432031)) {
           if (this.cancelCurrentForm()) {
             return bt.Status.Success;
           }
         }
         return bt.Status.Failure;
       }),

      // Check for emergency exit conditions
      new bt.Action(() => {
        const friendsNeedingHealing = this.getFriendsUnderHealthPercent(Settings.RampEmergencyExitPct);
        if (friendsNeedingHealing.length >= Settings.RampEmergencyExitCount) {
          this.rampModeActive = false;
          this.rampStartTime = 0;
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),

      // Ramp sequence (specific order and logic)

      // 1. Incarnation: Tree of Life at ramp START for 30% Rejuv mana discount + 40% Rejuv healing
      spell.cast("Incarnation: Tree of Life", req =>
        Settings.UseIncarnation &&
        spell.isSpellKnown("Incarnation: Tree of Life") &&
        !spell.isOnCooldown("Incarnation: Tree of Life")
      ),

      // 2. Innervate early in ramp to make it free
      spell.cast("Innervate", req =>
        Settings.UseInnervate &&
        spell.isSpellKnown("Innervate") &&
        !spell.isOnCooldown("Innervate")
      ),

      // 3. Wild Growth (regardless of health -- procs Grove Guardians passively)
      spell.cast("Wild Growth", req => !me.isMoving() || me.hasAuraByMe("Nature's Swiftness")),

      // 4. Lifebloom during ramp (respects global Lifebloom limits)
      spell.cast("Lifebloom", on => this.getRampLifebloomTarget(), req =>
        this.getRampLifebloomTarget() !== null &&
        spell.getTimeSinceLastCast("Lifebloom") > 5000
      ),

      // 5. Rejuvenation priority spread (buffed by Incarnation if active)

      // 5a. Non-tank without Lifebloom (highest priority)
      spell.cast("Rejuvenation", on => this.getRampRejuvTarget1(), req =>
        this.getRampRejuvTarget1() !== null
      ),

      // 5b. Me (if I don't have Rejuvenation)
      spell.cast("Rejuvenation", on => me, req =>
        !me.hasAura(auras.rejuvenation)
      ),

      // 5c. Any tank without Rejuvenation
      spell.cast("Rejuvenation", on => this.getRampRejuvTarget3(), req =>
        this.getRampRejuvTarget3() !== null
      ),

      // 5d. Lowest health friend without Rejuvenation
      spell.cast("Rejuvenation", on => this.getRampRejuvTarget4(), req =>
        this.getRampRejuvTarget4() !== null
      ),

      // 5e. Anyone without Rejuvenation (fallback)
      spell.cast("Rejuvenation", on => this.getRampRejuvTarget5(), req =>
        this.getRampRejuvTarget5() !== null
      ),

      // 6. Swiftmend to proc Power of the Archdruid + Grove Guardians (passive)
      spell.cast("Swiftmend", on => this.getSwiftmendTarget(), req =>
        this.getSwiftmendTarget() !== null
      ),

      // 7. Convoke as ramp payoff (50% mini-Flourish extends HoTs, spawns Grove Guardians)
      spell.cast("Convoke the Spirits", req =>
        Settings.UseConvoke &&
        spell.isSpellKnown("Convoke the Spirits") &&
        !me.hasAuraByMe(auras.catForm) &&
        !spell.isOnCooldown("Convoke the Spirits")
      ),

      // 8. Regrowth spam while Abundance stacks are high (100% crit, near-free mana)
      // Instant-cast during Incarnation: Tree of Life
      spell.cast("Regrowth", on => this.getRegrowthTarget(), req =>
        this.getRegrowthTarget() !== null &&
        this.getAbundanceStacks() >= 5 &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness") || me.hasVisibleAura("Incarnation: Tree of Life"))
      ),
    );
  }

  buildInterrupts() {
    return new bt.Selector(
      // Incapacitating Roar for AoE interrupt (3+ enemies casting within 10y)
      new bt.Decorator(
        () => Settings.UseIncapacitatingRoar &&
              this.getCastingEnemiesInRange(10) >= 3,
        spell.interrupt("Incapacitating Roar", false, 10)
      ),

      // Mighty Bash single-target interrupt
      new bt.Decorator(
        () => Settings.UseMightyBash &&
              spell.isSpellKnown("Mighty Bash"),
        spell.interrupt("Mighty Bash", false, 5)
      ),
    );
  }

  buildCooldowns() {
    return new bt.Selector(
      // Nature's Vigil for DPS (when we have HoTs active)
      spell.cast("Nature's Vigil", () =>
        Settings.UseNaturesVigil &&
        spell.isSpellKnown("Nature's Vigil") &&
        this.hasActiveHoTs() &&
        this.getCurrentTarget() !== null &&
        this.shouldUseBurstAbility()
      ),

      // Incarnation: Tree of Life (alternative to Convoke -- use before ramping for cheap Rejuvs)
      spell.cast("Incarnation: Tree of Life", () =>
        Settings.UseIncarnation &&
        spell.isSpellKnown("Incarnation: Tree of Life") &&
        !me.hasAuraByMe(auras.catForm) &&
        this.getFriendsUnderHealthPercent(Settings.IncarnationHealthPct).length >= Settings.IncarnationMinTargets
      ),

      // Convoke the Spirits (caster form for healing)
      spell.cast("Convoke the Spirits", () =>
        Settings.UseConvoke &&
        spell.isSpellKnown("Convoke the Spirits") &&
        !me.hasAuraByMe(auras.catForm) &&
        this.getFriendsUnderHealthPercent(Settings.ConvokeHealthPct).length >= Settings.ConvokeMinTargets
      ),

      // Innervate
      spell.cast("Innervate", () =>
        Settings.UseInnervate &&
        spell.isSpellKnown("Innervate") &&
        (me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) * 100) <= Settings.InnervateManaPercent
      ),

      // Ironbark
      spell.cast("Ironbark", on => this.getIronbarkTarget(), req =>
        Settings.UseIronbark &&
        this.getIronbarkTarget() !== null
      )
    );
  }

  buildHealingRotation() {
    return new bt.Selector(
      // With Lifetreading talented, Efflorescence auto-attaches to Lifebloom target -- skip manual placement
      spell.cast("Efflorescence", on => this.getBestEfflorescenceTarget(), req =>
        !me.hasAura(auras.lifetreading) &&
        Settings.MaintainEfflorescence &&
        Settings.UseEfflorescence &&
        this.getBestEfflorescenceTarget() !== null &&
        this.canCastEfflorescence() &&
        this.shouldUseEfflorescence() &&
        (!this.hasEfflorescenceActive() || this.shouldRecastEfflorescence())
      ),

      // Maintain Lifebloom (critical with Everbloom -- also maintains Efflorescence via Lifetreading)
      spell.cast("Lifebloom", on => this.getLifebloomTarget(), req =>
        Settings.MaintainLifebloom &&
        this.getLifebloomTarget() !== null &&
        spell.getTimeSinceLastCast("Lifebloom") > 5000
      ),

      // Swiftmend on CD -- procs Power of the Archdruid (2 free Rejuvs) and Grove Guardians (passive)
      // Verdant Infusion extends HoTs on target; prefer Lifebloom target with Everbloom
      spell.cast("Swiftmend", on => this.getSwiftmendTarget(), req =>
        this.getSwiftmendTarget() !== null
      ),

      // Wild Growth for healing (procs Grove Guardians passively)
      spell.cast("Wild Growth", () =>
        Settings.UseWildGrowthHealing &&
        this.getFriendsUnderHealthPercent(Settings.WildGrowthHealingHealthPct).length >= Settings.WildGrowthHealingMinTargets &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness"))
      ),

      // Regrowth with Omen of Clarity (free cast)
      spell.cast("Regrowth", on => this.getRegrowthTarget(), req =>
        me.hasAura(auras.omenOfClarity) &&
        this.getRegrowthTarget() !== null &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness"))
      ),

      // Regrowth with high Abundance stacks (100% crit, near-free mana)
      spell.cast("Regrowth", on => this.getRegrowthTarget(), req =>
        this.getAbundanceStacks() >= 8 &&
        this.getRegrowthTarget() !== null &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness"))
      ),

      // Wild Growth for group healing
      spell.cast("Wild Growth", () =>
        this.getFriendsUnderHealthPercent(Settings.WildGrowthHealthPct).length >= Settings.WildGrowthMinTargets &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness"))
      ),

      // Lifebloom as regular heal (separate from maintenance)
      spell.cast("Lifebloom", on => this.getLifebloomHealingTarget(), req =>
        Settings.UseLifebloomHealing &&
        this.getLifebloomHealingTarget() !== null &&
        spell.getTimeSinceLastCast("Lifebloom") > 5000
      ),

      // Regular Regrowth
      spell.cast("Regrowth", on => this.getRegrowthTarget(), req =>
        this.getRegrowthTarget() !== null &&
        (!me.isMoving() || me.hasAuraByMe("Nature's Swiftness"))
      ),

      // Rejuvenation spread
      spell.cast("Rejuvenation", on => this.getRejuvenationTarget(), req =>
        Settings.SpreadRejuvenation &&
        this.getRejuvenationTarget() !== null
      )
    );
  }

  buildDPSRotation() {
    return new bt.Selector(
      // Emergency exit from DPS if healing is needed
      new bt.Action(() => {
        const friendsNeedingHealing = this.getFriendsUnderHealthPercent(Settings.RegrowthHealthPct);
        if (friendsNeedingHealing.length > 0) {
          // Stop casting if in the middle of a spell
          if (me.isCastingOrChanneling) {
            me.stopCasting();
          }

          // Cancel cat form for emergency healing (unless form-locked)
          if (me.hasAuraByMe(auras.catForm) && !me.hasAuraByMe(432031)) {
            if (this.cancelCurrentForm()) {
              this.trackFormShift();
            }
          }

          // Track that we're doing emergency healing
          this.trackEmergencyHealing();

          return bt.Status.Success; // Exit DPS rotation to go heal
        }
        return bt.Status.Failure; // Continue with DPS
      }),

      // Main DPS rotation based on SimC APL
      this.buildSimcDPSRotation()
    );
  }

  buildSimcDPSRotation() {
    return new bt.Selector(
      // Heart of the Wild (if not in stealth)
      spell.cast("Heart of the Wild", () =>
        Settings.UseHeartOfTheWild &&
        !me.hasAuraByMe("Prowl") &&
        !me.hasAuraByMe("Shadowmeld") &&
        this.getEnemiesInRange(6) >= 1 &&
        this.shouldUseBurstAbility()
      ),

              // Cat rotation if we have Rake talent (cat weaving enabled)
        new bt.Decorator(
          () => Settings.UseCatWeaving && this.getEnemiesInRange(6) >= 1 &&
               this.getLowestHealthAlly()?.effectiveHealthPercent >= Settings.CatWeavingHealthPct &&
               this.canEnterCatFormAfterEmergency() &&
               this.isTargetEngagedByGroup(),
          this.buildCatDPSRotation()
        ),

      // Caster DPS rotation (only in combat)
      new bt.Decorator(
        () => me.inCombat(),
        this.buildCasterDPSRotation()
      )
    );
  }

  buildCatDPSRotation() {
    return new bt.Selector(
      // HIGHEST PRIORITY: Spend 5 combo points on finishers before doing anything else
      new bt.Decorator(
        () => me.hasAuraByMe(auras.catForm) && this.shouldSpendComboPointsBeforeExitingCat(),
        new bt.Action(() => {
          if (Settings.CatWeavingDebug) {
            console.info(`[RestoDruid] HIGH PRIORITY: Spending combo points before other abilities`);
          }
          return this.trySpendComboPoints() ? bt.Status.Success : bt.Status.Failure;
        })
      ),

      // Exit cat form when energy is too low for cat abilities
      new bt.Action(() => {
        if (me.hasAuraByMe(auras.catForm)) {
          const currentEnergy = me.powerByType(PowerType.Energy);
          const energyThreshold = Settings.CatFormEnergyThreshold;

          // Exit if energy is below threshold (but respect minimum duration and form-lock)
          if (currentEnergy < energyThreshold && this.canExitCatForm() && !me.hasAuraByMe(432031)) {
            if (this.cancelCurrentForm()) {
              this.trackFormShift();
            }
            return bt.Status.Success;
          }

          // Also exit if we need to heal someone (but respect minimum duration unless emergency and not form-locked)
          const friendsNeedingHealing = this.getFriendsUnderHealthPercent(Settings.RegrowthHealthPct);
          const isEmergency = this.isEmergencyHealing();
          if (friendsNeedingHealing.length > 0 && (isEmergency || this.canExitCatForm()) && !me.hasAuraByMe(432031)) {
            if (this.cancelCurrentForm()) {
              this.trackFormShift();
            }
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      }),



      // Rake with stealth/prowl/sudden ambush (highest priority)
      spell.cast("Rake", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        (me.hasAuraByMe("Shadowmeld") || me.hasAuraByMe(auras.prowl) || me.hasAuraByMe("Sudden Ambush"))
      ),

      // Heart of the Wild in cat form (if Convoke CD < 40s or no Convoke talent)
      spell.cast("Heart of the Wild", () =>
        Settings.UseHeartOfTheWild &&
        spell.isSpellKnown("Heart of the Wild") &&
        me.hasAuraByMe(auras.catForm) &&
        (!spell.isSpellKnown("Convoke the Spirits") || spell.getCooldown("Convoke the Spirits").timeleft < 40000 || !Settings.UseConvokeForDPS) &&
        this.getEnemiesInRange(6) >= 1 &&
        this.shouldUseBurstAbility()
      ),

       // Fluid Form optimization: Use Rake for Convoke setup if Rake would be next
       new bt.Decorator(
         () => this.hasTalent("Fluid Form") &&
               Settings.UseConvokeForDPS &&
               this.getEnemiesInRange(40) <= 6 &&
               !me.hasAuraByMe(auras.catForm) &&
               !me.hasAuraByMe(432031) &&
               spell.isSpellKnown("Convoke the Spirits") &&
               spell.getCooldown("Convoke the Spirits").timeleft <= 1500 &&
               (me.hasAuraByMe(auras.heartOfTheWild) ||
                !spell.isSpellKnown("Heart of the Wild") ||
                spell.getCooldown("Heart of the Wild").timeleft > 30000 ||
                !Settings.UseHeartOfTheWild) &&
               spell.getCooldown(1822).ready &&
               this.shouldCastRakeNext(),
        new bt.Action(() => {
          const target = this.getRakeTarget();
          if (target && me.distanceTo(target) <= 8) {
            const rakeSpell = spell.getSpell(1822);
            if (rakeSpell) {
              return spell.castPrimitive(rakeSpell, target) ? bt.Status.Success : bt.Status.Failure;
            }
          }
          return bt.Status.Failure;
        })
      ),

      // Convoke setup: Fluid Form — enter cat via Rake or Shred (auto-shift), no explicit Cat Form
      new bt.Action(() => {
        if (!this.hasTalent("Fluid Form")) {
          return bt.Status.Failure;
        }
        if (!(
          Settings.UseConvokeForDPS &&
          this.getEnemiesInRange(40) <= 6 &&
          !me.hasAuraByMe(auras.catForm) &&
          !me.hasAuraByMe(432031) &&
          me.powerByType(PowerType.Energy) >= Settings.CatFormEntryEnergyThreshold &&
          this.canShiftForms() &&
          spell.isSpellKnown("Convoke the Spirits") &&
          spell.getCooldown("Convoke the Spirits").timeleft <= 1500 &&
          (me.hasAuraByMe(auras.heartOfTheWild) ||
           !spell.isSpellKnown("Heart of the Wild") ||
           spell.getCooldown("Heart of the Wild").timeleft > 30000 ||
           !Settings.UseHeartOfTheWild)
        )) {
          return bt.Status.Failure;
        }
        const rakeTarget = this.getRakeTarget();
        if (rakeTarget && me.distanceTo(rakeTarget) <= 8 && spell.getCooldown(1822).ready) {
          const rakeSpell = spell.getSpell(1822);
          if (rakeSpell && spell.castPrimitive(rakeSpell, rakeTarget)) {
            this.trackComboGenerator("Rake");
            this.trackCatFormEntry();
            return bt.Status.Success;
          }
        }
        const ct = this.getCurrentTarget();
        if (ct && me.distanceTo(ct) <= 8 && this.isValidDPSTarget(ct) && spell.getCooldown(5221).ready) {
          const shredSpell = spell.getSpell(5221);
          if (shredSpell && spell.castPrimitive(shredSpell, ct)) {
            this.trackComboGenerator("Shred");
            this.trackCatFormEntry();
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      }),

      // Convoke setup: no Fluid Form — explicit Cat Form before Convoke (Rake does not auto-shift)
      new bt.Sequence(
        spell.cast("Cat Form", () =>
          !this.hasTalent("Fluid Form") &&
          Settings.UseConvokeForDPS &&
          this.getEnemiesInRange(40) <= 6 &&
          !me.hasAuraByMe(auras.catForm) &&
          me.powerByType(PowerType.Energy) >= Settings.CatFormEntryEnergyThreshold &&
          this.canShiftForms() &&
          spell.isSpellKnown("Convoke the Spirits") &&
          spell.getCooldown("Convoke the Spirits").timeleft <= 1500 &&
          (me.hasAuraByMe(auras.heartOfTheWild) ||
           !spell.isSpellKnown("Heart of the Wild") ||
           spell.getCooldown("Heart of the Wild").timeleft > 30000 ||
           !Settings.UseHeartOfTheWild)
        ),
        new bt.Action(() => {
          this.trackFormShift();
          this.trackCatFormEntry();
          return bt.Status.Success;
        })
      ),

      // Convoke the Spirits in cat form
      spell.cast("Convoke the Spirits", () =>
        Settings.UseConvokeForDPS &&
        spell.isSpellKnown("Convoke the Spirits") &&
        me.hasAuraByMe(auras.catForm) &&
        (me.hasAuraByMe(auras.heartOfTheWild) ||
         !spell.isSpellKnown("Heart of the Wild") ||
         spell.getCooldown("Heart of the Wild").timeleft > 30000 ||
         !Settings.UseHeartOfTheWild) &&
        this.getEnemiesInRange(6) >= 1 &&
        this.shouldUseBurstAbility()
      ),

      // Rip finisher (simplified like Shaman Flame Shock)
      spell.cast("Rip", on => this.getRipTarget(), req =>
        this.getRipTarget() !== null &&
        me.hasAuraByMe(auras.catForm) &&
        me.powerByType(PowerType.ComboPoints) >= 5
      ),

      // Thrash Cat for AoE (>4 targets)
      new bt.Sequence(
        spell.cast("Thrash", on => this.getCurrentTarget(), req =>
          this.getCurrentTarget() !== null &&
          me.hasAuraByMe(auras.catForm) &&
          this.getEnemiesInRange(8) > 4 &&
          this.getTimeToDeath(this.getCurrentTarget()) > 5000 &&
          (!this.getCurrentTarget().getAuraByMe("Thrash") || this.getCurrentTarget().getAuraByMe("Thrash").remaining < 3000) &&
          !me.hasAuraByMe(auras.prowl)
        ),
        new bt.Action(() => {
          this.trackComboGenerator("Thrash");
          return bt.Status.Success;
        })
      ),

      // Moonfire/Sunfire removed from cat DPS -- they're caster spells that break Cat Form.
      // Handled in buildCasterDPSRotation() when you're in caster form instead.

      // Rake for DoT maintenance (simplified like Shaman Flame Shock)
      new bt.Sequence(
        spell.cast("Rake", on => this.getRakeTarget(), req =>
          this.getRakeTarget() !== null &&
          me.hasAuraByMe(auras.catForm)
        ),
        new bt.Action(() => {
          this.trackComboGenerator("Rake");
          return bt.Status.Success;
        })
      ),

      // Fluid Form: enter cat via Rake when out of form (auto-shift)
      new bt.Decorator(
        () => {
          if (!this.hasTalent("Fluid Form")) return false;
          const shouldRake = this.shouldCastRakeNext();
          const notInCat = !me.hasAuraByMe(auras.catForm);
          const notFormLocked = !me.hasAuraByMe(432031);
          const hasEnergy = me.powerByType(PowerType.Energy) > 60;
          const rakeReady = spell.getCooldown(1822).ready;
          const hasAttackableTargets = this.getAttackableEnemiesInRange(8) > 0;

          if (Settings.CatWeavingDebug && notInCat && hasEnergy) {
            console.info(`[RestoDruid] Fluid Form Rake check - ShouldRake: ${shouldRake}, RakeReady: ${rakeReady}, FormLocked: ${!notFormLocked}, AttackableTargets: ${hasAttackableTargets}`);
          }

          return notInCat && notFormLocked && hasEnergy && rakeReady && shouldRake && hasAttackableTargets;
        },
        new bt.Sequence(
          spell.cast("Rake", on => this.getRakeTarget(), req =>
            this.getRakeTarget() !== null &&
            me.distanceTo(this.getRakeTarget()) <= 8
          ),
          new bt.Action(() => {
            this.trackComboGenerator("Rake");
            this.trackCatFormEntry();
            if (Settings.CatWeavingDebug) {
              console.info(`[RestoDruid] Used Fluid Form Rake to enter Cat Form`);
            }
            return bt.Status.Success;
          })
        )
      ),

      // No Fluid Form: explicit Cat Form to enter melee form (Rake does not auto-shift)
      new bt.Sequence(
        spell.cast("Cat Form", () =>
          !this.hasTalent("Fluid Form") &&
          !me.hasAuraByMe(auras.catForm) &&
          me.powerByType(PowerType.Energy) >= Settings.CatFormEntryEnergyThreshold &&
          this.canShiftForms() &&
          this.getAttackableEnemiesInRange(8) > 0
        ),
        new bt.Action(() => {
          this.trackFormShift();
          this.trackCatFormEntry();
          return bt.Status.Success;
        })
      ),

      // Sunfire refresh after Moonfire
      spell.cast("Sunfire", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        this.wasLastSpell("Moonfire") &&
        this.unitHasSunfire(this.getCurrentTarget()) &&
        this.unitHasSunfire(this.getCurrentTarget()).remaining < (this.unitHasSunfire(this.getCurrentTarget()).duration * 0.8)
      ),

      // Starfire for AoE with Heart of the Wild
      spell.cast("Starfire", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        !me.hasAuraByMe(auras.catForm) &&
        me.hasAuraByMe(auras.heartOfTheWild) &&
        this.getEnemiesInRange(40) > 7
      ),

      // Starsurge (single target or <8 enemies, not in cat form)
      spell.cast("Starsurge", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        (this.getEnemiesInRange(40) === 1 || (this.getEnemiesInRange(40) < 8 && !me.hasAuraByMe(auras.catForm)))
      ),

      // Fluid Form: enter cat via Shred when out of form (auto-shift)
      new bt.Decorator(
        () => this.hasTalent("Fluid Form") &&
              !me.hasAuraByMe(auras.catForm) &&
              !me.hasAuraByMe(432031) &&
              me.powerByType(PowerType.Energy) > 50 &&
              spell.getCooldown(5221).ready &&
              this.getAttackableEnemiesInRange(8) > 0 &&
              this.shouldCastShredNext(),
        new bt.Sequence(
          spell.cast("Shred", on => this.getCurrentTarget(), req =>
            this.getCurrentTarget() !== null &&
            me.distanceTo(this.getCurrentTarget()) <= 8 &&
            this.isValidDPSTarget(this.getCurrentTarget())
          ),
          new bt.Action(() => {
            this.trackComboGenerator("Shred");
            this.trackCatFormEntry();
            return bt.Status.Success;
          })
        )
      ),

      // Ferocious Bite finisher
      spell.cast("Ferocious Bite", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        me.hasAuraByMe(auras.catForm) &&
        this.getEnemiesInRange(8) < 4 &&
        ((me.powerByType(PowerType.ComboPoints) > 3 && this.getTimeToDeath(this.getCurrentTarget()) < 3000) ||
         (me.powerByType(PowerType.ComboPoints) >= 5 && me.powerByType(PowerType.Energy) >= 50 &&
          this.getCurrentTarget().getAuraByMe("Rip") && this.getCurrentTarget().getAuraByMe("Rip").remaining > 10000))
      ),

      // Thrash Cat for smaller AoE (>2 targets)
      new bt.Sequence(
        spell.cast("Thrash", on => this.getCurrentTarget(), req =>
          this.getCurrentTarget() !== null &&
          me.hasAuraByMe(auras.catForm) &&
          this.getEnemiesInRange(8) > 2 &&
          this.getTimeToDeath(this.getCurrentTarget()) > 5000 &&
          (!this.getCurrentTarget().getAuraByMe("Thrash") || this.getCurrentTarget().getAuraByMe("Thrash").remaining < 3000) &&
          !me.hasAuraByMe(auras.prowl)
        ),
        new bt.Action(() => {
          this.trackComboGenerator("Thrash");
          return bt.Status.Success;
        })
      ),

      // Rake for general DoT maintenance (simplified like Shaman Flame Shock)
      new bt.Decorator(
        () => me.hasAuraByMe(auras.catForm) && spell.getCooldown(1822).ready,
        new bt.Action(() => {
          const target = this.getRakeTarget();
          if (target) {
            const rakeSpell = spell.getSpell(1822);
            if (rakeSpell) {
              if (spell.castPrimitive(rakeSpell, target)) {
                this.trackComboGenerator("Rake");
                return bt.Status.Success;
              }
            }
          }
          return bt.Status.Failure;
        })
      ),

      // Swipe Cat for AoE combo points
      spell.cast("Swipe", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        me.hasAuraByMe(auras.catForm) &&
        this.getEnemiesInRange(8) > 2 &&
        me.powerByType(PowerType.ComboPoints) < 5 &&
        !me.hasAuraByMe(auras.prowl)
      ),

      // Thrash Cat maintenance
      spell.cast("Thrash", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        me.hasAuraByMe(auras.catForm) &&
        this.getTimeToDeath(this.getCurrentTarget()) > 5000 &&
        (!this.getCurrentTarget().getAuraByMe("Thrash") || this.getCurrentTarget().getAuraByMe("Thrash").remaining < 3000) &&
        !me.hasAuraByMe(auras.prowl)
      ),

      // Shred for combo points (simplified for debugging)
      new bt.Sequence(
        spell.cast("Shred", on => this.getCurrentTarget(), req =>
          this.getCurrentTarget() !== null &&
          me.hasAuraByMe(auras.catForm) &&
          me.distanceTo(this.getCurrentTarget()) <= 5 &&
          me.powerByType(PowerType.Energy) >= 40 &&
          me.powerByType(PowerType.ComboPoints) < 5
        ),
        new bt.Action(() => {
          this.trackComboGenerator("Shred");
          return bt.Status.Success;
        })
      ),

      // Fluid Form: Rake fallback to enter cat when out of form
      new bt.Decorator(
        () => this.hasTalent("Fluid Form") &&
              !me.hasAuraByMe(auras.catForm) &&
              !me.hasAuraByMe(432031) &&
              spell.getCooldown(1822).ready &&
              this.getAttackableEnemiesInRange(8) > 0 &&
              this.shouldCastRakeNext(),
        new bt.Action(() => {
          const target = this.getRakeTarget();
          if (target && me.distanceTo(target) <= 8) {
            const rakeSpell = spell.getSpell(1822);
            if (rakeSpell) {
              if (spell.castPrimitive(rakeSpell, target)) {
                this.trackCatFormEntry();
                return bt.Status.Success;
              }
            }
          }
          return bt.Status.Failure;
        })
      ),

      // Basic Shred fallback (should always work in cat form with energy)
      new bt.Sequence(
        spell.cast("Shred", on => this.getCurrentTarget(), req =>
          this.getCurrentTarget() !== null &&
          me.hasAuraByMe(auras.catForm) &&
          me.powerByType(PowerType.Energy) >= 40
        ),
        new bt.Action(() => {
          this.trackComboGenerator("Shred");
          return bt.Status.Success;
        })
      ),
    );
  }



  buildCasterDPSRotation() {
    return new bt.Selector(

      // Sunfire DoT maintenance (simplified like Rake/Rip)
      spell.cast("Sunfire", on => this.getSunfireTarget(), req =>
        Settings.MaintainSunfire &&
        this.getSunfireTarget() !== null
      ),

      // Starfire for AoE scenarios
      spell.cast("Starfire", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        !me.hasAuraByMe(auras.catForm) &&
        ((this.getEnemiesInRange(40) > 1 && me.hasAuraByMe(auras.heartOfTheWild)) ||
         this.getEnemiesInRange(40) > 5)
      ),

      // Moonfire DoT maintenance (simplified like Rake/Rip)
      spell.cast("Moonfire", on => this.getMoonfireTarget(), req =>
        Settings.MaintainMoonfire &&
        this.getMoonfireTarget() !== null
      ),

      // Starsurge for single target or small groups
      spell.cast("Starsurge", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        !me.hasAuraByMe(auras.catForm) &&
        this.getEnemiesInRange(40) < 8
      ),

      // Starfire with Heart of the Wild or multi-target
      spell.cast("Starfire", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        !me.hasAuraByMe(auras.catForm) &&
        (this.getEnemiesInRange(40) > 1 || me.hasAuraByMe(auras.heartOfTheWild))
      ),

      // Melee Shred from caster: Fluid Form = auto-shift only; no Fluid Form = Cat Form then Shred
      new bt.Selector(
        new bt.Decorator(
          () => this.hasTalent("Fluid Form"),
          new bt.Sequence(
            new bt.Action(() => {
              this._casterShredEnteredFromCaster = !me.hasAuraByMe(auras.catForm);
              return bt.Status.Success;
            }),
            spell.cast("Shred", on => this.getCurrentTarget(), req =>
              this.getCurrentTarget() !== null &&
              me.distanceTo(this.getCurrentTarget()) <= 8 &&
              this.isValidDPSTarget(this.getCurrentTarget()) &&
              me.powerByType(PowerType.Energy) >= 40
            ),
            new bt.Action(() => {
              this.trackComboGenerator("Shred");
              if (this._casterShredEnteredFromCaster) {
                this.trackCatFormEntry();
              }
              return bt.Status.Success;
            })
          )
        ),
        new bt.Sequence(
          spell.cast("Cat Form", () =>
            !this.hasTalent("Fluid Form") &&
            !me.hasAuraByMe(auras.catForm) &&
            me.powerByType(PowerType.Energy) >= Settings.CatFormEntryEnergyThreshold &&
            this.canShiftForms() &&
            this.getAttackableEnemiesInRange(8) > 0
          ),
          new bt.Action(() => {
            this.trackFormShift();
            this.trackCatFormEntry();
            return bt.Status.Success;
          }),
          spell.cast("Shred", on => this.getCurrentTarget(), req =>
            this.getCurrentTarget() !== null &&
            me.hasAuraByMe(auras.catForm) &&
            me.distanceTo(this.getCurrentTarget()) <= 8 &&
            this.isValidDPSTarget(this.getCurrentTarget()) &&
            me.powerByType(PowerType.Energy) >= 40
          ),
          new bt.Action(() => {
            this.trackComboGenerator("Shred");
            return bt.Status.Success;
          })
        )
      ),

      // Wrath filler
      spell.cast("Wrath", on => this.getCurrentTarget(), req =>
        this.getCurrentTarget() !== null &&
        !me.hasAuraByMe(auras.catForm) &&
        (this.hasTalent("Starfire") || this.getAttackableEnemiesInRange(8) === 0)
      )
    );
  }

  // Helper methods
  getCurrentTarget() {
    const targetPredicate = unit =>
      common.validTarget(unit) &&
      me.distanceTo(unit) <= 40 &&
      me.isFacing(unit) &&
      !unit.isImmune() &&
      this.isValidDPSTarget(unit);

    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  isValidDPSTarget(unit) {
    // Only attack enemies that are engaged with our group
    if (!unit) return false;

    // Check if I'm in combat with the target
    if (me.inCombatWith(unit)) {
      return true;
    }

    // Check if any tank is in combat with the target
    try {
      const tanks = heal.friends.Tanks;
      for (const tank of tanks) {
        if (tank && !tank.deadOrGhost && tank.inCombatWith(unit)) {
          return true;
        }
      }
    } catch (error) {
      // If tank check fails, fall back to me being in combat
    }

    // Training dummies are always valid (for practice)
    if (unit.name && unit.name.toLowerCase().includes('dummy')) {
      return true;
    }

    return false;
  }

  getLowestHealthAlly() {
    return heal.friends.All.filter(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40
    ).sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0] || null;
  }

  getCriticalHealthAlly() {
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      friend.effectiveHealthPercent <= Settings.NatureSwiftnessHealthPct
    ) || null;
  }

  getRegrowthTarget() {
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      me.isFacing(friend) &&
      friend.effectiveHealthPercent <= Settings.RegrowthHealthPct
    ) || null;
  }

  getRejuvenationTarget() {
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      friend.effectiveHealthPercent <= Settings.RejuvenationHealthPct &&
      !friend.hasAuraByMe(auras.rejuvenation)
    ) || null;
  }

  hasEverbloom() {
    return me.hasAura(auras.everbloom) || spell.isSpellKnown("Everbloom");
  }

  friendHasLifebloom(friend) {
    return friend.hasAuraByMe(auras.lifebloomResto) || friend.hasAuraByMe(auras.lifebloom) || friend.hasAuraByMe("Lifebloom");
  }

  getLifebloomAura(friend) {
    return friend.getAuraByMe(auras.lifebloomResto) || friend.getAuraByMe(auras.lifebloom) || friend.getAuraByMe("Lifebloom");
  }

  getLifebloomTarget() {
    if (!Settings.MaintainLifebloom) return null;

    const isExpiring = (friend) => {
      const aura = this.getLifebloomAura(friend);
      if (!aura) return false;
      const remaining = aura.remaining;
      return remaining === null || remaining === undefined || remaining === 0 || remaining <= 3500;
    };

    const inRange = (friend) => friend && !friend.deadOrGhost && me.distanceTo(friend) <= 40;

    // With Everbloom, never move Lifebloom -- losing stacks is very costly.
    // Only refresh the existing target when expiring.
    if (this.hasEverbloom()) {
      const currentLB = heal.friends.All.find(f => inRange(f) && this.friendHasLifebloom(f));
      if (currentLB) {
        return isExpiring(currentLB) ? currentLB : null;
      }
    }

    // If someone already has Lifebloom, only return them if it's expiring (pandemic refresh)
    const currentLB = heal.friends.All.find(f => inRange(f) && this.friendHasLifebloom(f));
    if (currentLB) {
      return isExpiring(currentLB) ? currentLB : null;
    }

    // No active Lifebloom -- pick a new target. TANK FIRST, always.
    const tank = heal.friends.Tanks.find(t => inRange(t));
    if (tank) return tank;

    // Only Lifebloom a non-tank if they're critically low (<40% HP)
    const criticalFriend = heal.friends.All.find(f =>
      inRange(f) && f.effectiveHealthPercent < 40
    );
    if (criticalFriend) return criticalFriend;

    return null;
  }

  getLifebloomHealingTarget() {
    // This is for reactive healing - respects global Lifebloom limits and duration
    if (!Settings.UseLifebloomHealing) return null;

    // Count current active Lifeblooms
    const currentLifeblooms = heal.friends.All.filter(friend =>
      friend && !friend.deadOrGhost && this.friendHasLifebloom(friend)
    ).length;

    // Midnight: keep a single Lifebloom target.
    const maxLifeblooms = 1;

    // If we're at max Lifeblooms, only refresh expiring ones (< 4 seconds)
    if (currentLifeblooms >= maxLifeblooms) {
      const expiringLifebloom = heal.friends.All.find(friend => {
        if (!friend || friend.deadOrGhost || me.distanceTo(friend) > 40) return false;

        const lifebloomAura = this.getLifebloomAura(friend);
        if (!lifebloomAura) return false;

        const remaining = lifebloomAura.remaining || 0;
        return remaining !== null && remaining <= 4000; // 4 seconds
      });

      // Only return expiring Lifebloom if the target also needs healing
      if (expiringLifebloom && expiringLifebloom.effectiveHealthPercent <= Settings.LifebloomHealingHealthPct) {
        return expiringLifebloom;
      }

      return null; // At max Lifeblooms and none expiring or needing heal
    }

    // We can cast new Lifeblooms - find lowest health friend who needs healing and doesn't have Lifebloom
    const target = heal.friends.All
      .filter(friend =>
        friend && !friend.deadOrGhost &&
        me.distanceTo(friend) <= 40 &&
        friend.effectiveHealthPercent <= Settings.LifebloomHealingHealthPct &&
        !this.friendHasLifebloom(friend) // Don't overwrite our own Lifebloom
      )
      .sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0];

    return target || null;
  }

  getSwiftmendTarget() {
    const hasHoT = friend =>
      friend.hasAuraByMe(auras.rejuvenation) || friend.hasAuraByMe(auras.regrowth) || friend.hasAuraByMe(auras.wildGrowth);

    const validFriend = friend =>
      friend && !friend.deadOrGhost && me.distanceTo(friend) <= 40 &&
      friend.effectiveHealthPercent <= Settings.SwiftmendHealthPct && hasHoT(friend);

    // With Everbloom, prefer Swiftmending the Lifebloom target for Verdant Infusion auto-refresh
    if (this.hasEverbloom()) {
      const lbTarget = heal.friends.All.find(f =>
        f && !f.deadOrGhost && me.distanceTo(f) <= 40 &&
        this.friendHasLifebloom(f) &&
        f.effectiveHealthPercent <= Settings.SwiftmendHealthPct && hasHoT(f)
      );
      if (lbTarget) return lbTarget;
    }

    return heal.friends.All.find(validFriend) || null;
  }

  getIronbarkTarget() {
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      (friend.guid !== me.guid || (!me.hasAuraByMe(auras.barkskin))) &&
      friend.inCombat() &&
      friend.effectiveHealthPercent <= Settings.IronbarkHealthPct
    ) || null;
  }

  getInterruptTarget() {
    return combat.targets.find(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 30 &&
      enemy.isCastingOrChanneling
    ) || null;
  }

  getCastingEnemiesInRange(range) {
    return combat.targets.filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= range &&
      enemy.isCastingOrChanneling
    ).length;
  }

  getFriendsUnderHealthPercent(percentage) {
    return heal.friends.All.filter(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      friend.effectiveHealthPercent <= percentage
    );
  }

  getGroupedAllies(range) {
    const centerAlly = this.getLowestHealthAlly();
    if (!centerAlly) return [];

    return heal.friends.All.filter(friend =>
      friend &&
      !friend.deadOrGhost &&
      centerAlly.distanceTo(friend) <= range
    );
  }

  getEnemiesInRange(range) {
    return me.getEnemies(range).filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= range
    ).length;
  }

  getAttackableEnemiesInRange(range) {
    // Get enemies that are actually valid for DPS (for cat form vs Wrath decisions)
    return me.getEnemies(range).filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= range &&
      me.canAttack(enemy) &&
      !enemy.isImmune() &&
      !this.isBlacklistedEnemy(enemy) &&
      this.isValidDPSTarget(enemy)
    ).length;
  }

  isBlacklistedEnemy(enemy) {
    // Check if enemy should be excluded from melee range calculations
    if (!enemy || !enemy.name) return false;

    const enemyName = enemy.name.toLowerCase();

    // Blacklisted enemy types
    const blacklistedNames = [
      "bloodworker",
      "grasping blood"
    ];

    return blacklistedNames.some(name => enemyName.includes(name));
  }

  hasEfflorescenceActive() {
    // In efflorescence from any source (full aura list; visible list misses some buffs)
    return me.hasAura(auras.efflorescenceAura);
  }

  getActiveEfflorescence() {
    // Get the actual Efflorescence area trigger object (using ESP's approach)
    let activeEfflorescence = null;

    objMgr.objects.forEach((obj) => {
      // Use ESP's validation method
      if (obj instanceof wow.CGAreaTrigger) {
        try {
          // Validate the area trigger like ESP does
          const _ = obj.guid;
          const __ = obj.spellId;

          // Check if it's our Efflorescence
          if (obj.caster && obj.caster.equals(me.guid)) {
            activeEfflorescence = obj;

          }
        } catch (error) {
          // Invalid area trigger, skip
        }
      }
    });



    return activeEfflorescence;
  }

  getFriendsInEfflorescence() {
    // If we don't have Efflorescence active, return empty
    if (!this.hasEfflorescenceActive()) return [];

    // Get the actual area trigger and check distance from its position
    const efflorescence = this.getActiveEfflorescence();
          if (!efflorescence) {
        return [];
      }

    // Use distance-based detection since numPlayersInside might be stale
    const allFriendsIncludingMe = [...heal.friends.All, me];
    const availableFriends = allFriendsIncludingMe.filter(friend =>
      friend && !friend.deadOrGhost
    );

    // Check which friends are actually within Efflorescence radius (8 yards)
    const friendsInRange = availableFriends.filter(friend => {
      const distance = friend.distanceTo(efflorescence);
      return distance <= 8;
    });

    return friendsInRange;
  }

  getBestEfflorescenceTarget() {
    // Priority 1: Friend with most other friends in 8y radius (Efflorescence radius)
    let bestTarget = null;
    let maxFriendsInRange = 0;

    for (const friend of heal.friends.All) {
      if (!friend || friend.deadOrGhost || me.distanceTo(friend) > 40) continue;

      const friendsInRange = heal.friends.All.filter(ally =>
        ally && !ally.deadOrGhost && friend.distanceTo(ally) <= 8 // Use actual Efflorescence radius
      ).length;

      if (friendsInRange > maxFriendsInRange) {
        maxFriendsInRange = friendsInRange;
        bestTarget = friend;
      }
    }

    // Require at least 2 friends in range for priority 1
    if (bestTarget && maxFriendsInRange >= 2) {
      return bestTarget;
    }

    // Priority 2: Tank if exists
    const tank = heal.friends.Tanks.find(tank =>
      tank && !tank.deadOrGhost && me.distanceTo(tank) <= 40
    );
    if (tank) {
      return tank;
    }

    // Priority 3: Me
    return me;
  }

  shouldRecastEfflorescence() {
    // Don't recast too frequently to avoid spam
    if (this.lastEfflorescenceCheck && (wow.frameTime - this.lastEfflorescenceCheck) < 3000) {
      return false;
    }
    this.lastEfflorescenceCheck = wow.frameTime;

    // Get current friends in Efflorescence area trigger
    const friendsInCurrent = this.getFriendsInEfflorescence();
    const bestTarget = this.getBestEfflorescenceTarget();



    // If no one is in current Efflorescence, definitely move it
    if (friendsInCurrent.length === 0) {
      if (bestTarget) {
        const friendsAtBest = heal.friends.All.filter(ally =>
          ally && !ally.deadOrGhost && bestTarget.distanceTo(ally) <= 8
        ).length;

        // Only move if at least 1 friend would benefit from new position
        return friendsAtBest >= 1;
      }
    }

    // If people are in current Efflorescence, only move for significant improvement
    if (!bestTarget) return false;

    const friendsAtBest = heal.friends.All.filter(ally =>
      ally && !ally.deadOrGhost && bestTarget.distanceTo(ally) <= 8
    ).length;



    // Only recast if significantly more friends would benefit (at least 2 more)
    return friendsAtBest >= (friendsInCurrent.length + 2);
  }

  hasTalent(talentName) {
    // Check if we have a talent - simplified implementation
    switch(talentName) {
      case "Fluid Form":
        return me.hasAura(auras.fluidForm);
      case "Rip":
        // Check if we have access to Rip ability (cat form DPS)
        return me.hasAura(1079);
      default:
        // Generic talent check by name
        return me.hasAura(talentName);
    }
  }

  wasLastSpell(spellName) {
    // Check if the last spell cast was the specified spell
    const lastSpells = spell.getLastSuccessfulSpells(1);
    return lastSpells.length > 0 && lastSpells[0].name === spellName;
  }

  getTimeToDeath(unit) {
    // Custom time to death calculation
    if (!unit) return 0;

    // Training dummies should be treated as having infinite time
    if (unit.name && unit.name.toLowerCase().includes('dummy')) {
      return 999999;
    }

    // Use the unit's built-in timeToDeath calculation
    return unit.timeToDeath() || 999999; // Default to high value if no calculation available
  }

  getAuraRemainingTime(unit, auraName) {
    if (!unit) return 0;
    const aura = unit.getAuraByMe(auraName);
    return aura ? aura.remaining : 0;
  }

  getAbundanceStacks() {
    const abundanceAura = me.getAura(auras.abundance);
    return abundanceAura ? (abundanceAura.stacks || 0) : 0;
  }

  isTargetEngagedByGroup() {
    // Check if current target is engaged by me or a friendly tank, or is a training dummy
    const target = this.getCurrentTarget();
    if (!target) return false;
    if (!me.isFacing(target)) return false;

    // Training dummies are always valid targets
    if (target.name && target.name.toLowerCase().includes('dummy')) {
      return true;
    }

    // Check if I'm in combat with the target
    if (me.inCombatWith(target)) {
      return true;
    }

    // Check if any friendly tank is in combat with the target
    const tanks = heal.friends.Tanks;
    for (const tank of tanks) {
      if (tank && !tank.deadOrGhost && tank.inCombatWith(target)) {
        return true;
      }
    }

    return false;
  }

  // Multi-target DoT management helpers
  getRipTarget() {
    // Resto cat weaving: only Rip your current target, don't spread to other mobs
    if (!me.target || !me.targetUnit) return null;
    if (me.distanceTo(me.targetUnit) > 5) return null;
    if (!this.isValidDPSTarget(me.targetUnit)) return null;

    const ripAura = me.targetUnit.getAuraByMe("Rip");
    if (ripAura && ripAura.remaining >= 10000) return null;

    if (Settings.RespectRipTTD && this.getTimeToDeath(me.targetUnit) < (Settings.RipMinTTD * 1000)) return null;

    return me.target;
  }

  getRakeTarget() {
    // Resto cat weaving: only Rake your current target, don't spread to other mobs
    if (!me.target || !me.targetUnit) return null;
    if (me.distanceTo(me.targetUnit) > 5) return null;
    if (!this.isValidDPSTarget(me.targetUnit)) return null;

    const rakeAura = me.targetUnit.getAuraByMe("Rake");
    if (rakeAura && rakeAura.remaining >= 3000) return null;

    if (Settings.RespectRakeTTD && this.getTimeToDeath(me.targetUnit) < (Settings.RakeMinTTD * 1000)) return null;

    return me.target;
  }

  unitHasMoonfire(unit) {
    return unit.getAuraByMe(auras.moonfire) || unit.getAuraByMe("Moonfire");
  }

  unitHasSunfire(unit) {
    return unit.getAuraByMe(auras.sunfire) || unit.getAuraByMe("Sunfire");
  }

  getMoonfireTarget() {
    if (me.target && me.targetUnit && me.distanceTo(me.targetUnit) <= 40 && this.isValidDPSTarget(me.targetUnit)) {
      const moonfireAura = this.unitHasMoonfire(me.targetUnit);
      const moonfireRemaining = moonfireAura ? moonfireAura.remaining : 0;

      if (!moonfireAura || moonfireRemaining < 5000) {
        if (this.getTimeToDeath(me.targetUnit) >= (Settings.MoonfireMinTTD * 1000)) {
          return me.target;
        }
      }
    }

    // Only check combat.targets, not all units in 40y -- avoid dotting random mobs
    return combat.targets.find(unit =>
      unit &&
      !unit.deadOrGhost &&
      me.distanceTo(unit) <= 40 &&
      me.isFacing(unit) &&
      !unit.isImmune() &&
      me.withinLineOfSight(unit) &&
      me.canAttack(unit) &&
      this.isValidDPSTarget(unit) &&
      this.getTimeToDeath(unit) >= (Settings.MoonfireMinTTD * 1000) &&
      !this.unitHasMoonfire(unit)
    ) || null;
  }

  getSunfireTarget() {
    if (me.target && me.targetUnit && me.distanceTo(me.targetUnit) <= 40 && this.isValidDPSTarget(me.targetUnit)) {
      const sunfireAura = this.unitHasSunfire(me.targetUnit);
      const sunfireRemaining = sunfireAura ? sunfireAura.remaining : 0;

      if (!sunfireAura || sunfireRemaining < 5000) {
        if (this.getTimeToDeath(me.targetUnit) >= (Settings.SunfireMinTTD * 1000)) {
          return me.target;
        }
      }
    }

    // Only check combat.targets, not all units in 40y
    return combat.targets.find(unit =>
      unit &&
      !unit.deadOrGhost &&
      me.distanceTo(unit) <= 40 &&
      me.isFacing(unit) &&
      !unit.isImmune() &&
      me.withinLineOfSight(unit) &&
      me.canAttack(unit) &&
      this.isValidDPSTarget(unit) &&
      this.getTimeToDeath(unit) >= (Settings.SunfireMinTTD * 1000) &&
      !this.unitHasSunfire(unit)
    ) || null;
  }

  // Ramp-specific targeting methods
  getRampLifebloomTarget() {

    const uniqueTargets = new Set();

    // Add all friends with error handling
    try {
      heal.friends.All.forEach(friend => {
        try {
          if (friend && !friend.deadOrGhost && me.distanceTo(friend) <= 40) {
            uniqueTargets.add(friend);
          }
        } catch (friendError) {
          // Skip this friend if it causes errors
        }
      });
    } catch (error) {
      // If heal.friends.All iteration fails, continue with just me
    }

    // Add me if not already included
    if (me && !me.deadOrGhost) {
      uniqueTargets.add(me);
    }

    const availableTargets = Array.from(uniqueTargets);

    // Midnight: keep a single Lifebloom target during ramp.
    const maxLifeblooms = 1;

    // Count current Lifeblooms globally
    const allTargetsIncludingMe = [...heal.friends.All, me];
    const currentLifeblooms = allTargetsIncludingMe.filter(friend => {
      try {
        return friend && !friend.deadOrGhost && this.friendHasLifebloom(friend);
      } catch (error) {
        return false;
      }
    }).length;

    // If we already have max Lifeblooms, don't cast more during ramp
    if (currentLifeblooms >= maxLifeblooms) {
      return null;
    }

    // Tank first, always
    const tank = heal.friends.Tanks.find(t =>
      t && !t.deadOrGhost && me.distanceTo(t) <= 40 && !this.friendHasLifebloom(t)
    );
    if (tank) return tank;

    // During ramp, fall back to any non-tank without Lifebloom
    const fallback = heal.friends.All.find(f =>
      f && !f.deadOrGhost && me.distanceTo(f) <= 40 && !this.friendHasLifebloom(f)
    );
    return fallback || null;
  }

  // Ramp Rejuvenation targeting (specific priority order)
  getRampRejuvTarget1() {
    // 1. Non-tank without Lifebloom (highest priority)
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      !this.isFriendATank(friend) &&
      !this.friendHasLifebloom(friend) &&
      !friend.hasAuraByMe(auras.rejuvenation)
    ) || null;
  }

  getRampRejuvTarget3() {
    // 3. Any tank without Rejuvenation
    return heal.friends.Tanks.find(tank =>
      tank &&
      !tank.deadOrGhost &&
      me.distanceTo(tank) <= 40 &&
      !tank.hasAuraByMe(auras.rejuvenation)
    ) || null;
  }

  getRampRejuvTarget4() {
    // 4. Lowest health friend without Rejuvenation
    const friendsWithoutRejuv = heal.friends.All.filter(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      !friend.hasAuraByMe(auras.rejuvenation)
    );

    return friendsWithoutRejuv.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0] || null;
  }

  getRampRejuvTarget5() {
    // 5. Anyone without Rejuvenation (fallback)
    const allTargets = [...heal.friends.All, me];
    return allTargets.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      !friend.hasAuraByMe(auras.rejuvenation)
    ) || null;
  }

  isFriendATank(friend) {
    return heal.friends.Tanks.some(tank =>
      tank && tank.guid.equals(friend.guid)
    );
  }

  hasActiveHoTs() {
    // Check if we have HoTs active on friends for Nature's Vigil synergy
    const friendsWithHoTs = heal.friends.All.filter(friend =>
      friend && !friend.deadOrGhost &&
      (this.friendHasLifebloom(friend) ||
       friend.hasAuraByMe(auras.rejuvenation) ||
       friend.hasAuraByMe(auras.regrowth))
    );

    return friendsWithHoTs.length >= 2; // At least 2 friends with HoTs
  }

  getTargetWithoutRip() {
    return combat.targets.find(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 5 &&
      this.getTimeToDeath(enemy) > 5000 &&  // Reduced from 15000 for better dummy support
      !enemy.hasAuraByMe("Rip")
    ) || null;
  }

  getTargetsNeedingMoonfire() {
    return combat.targets.filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 40 &&
      this.getTimeToDeath(enemy) > 12000 &&
      (!this.unitHasMoonfire(enemy) || this.unitHasMoonfire(enemy).remaining < 5000)
    );
  }

  getTargetsNeedingSunfire() {
    return combat.targets.filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 40 &&
      this.getTimeToDeath(enemy) > 5000 &&
      (!this.unitHasSunfire(enemy) || this.unitHasSunfire(enemy).remaining < 5000)
    );
  }

  getBestSunfireTarget() {
    const enemies = combat.targets.filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 40 &&
      this.getTimeToDeath(enemy) > 5000
    );

    // Priority: refreshable targets, then targets without Sunfire
    let bestTarget = null;
    let bestPriority = -1;

    for (const enemy of enemies) {
      let priority = 0;
      const sunfireAura = this.unitHasSunfire(enemy);
      const hasSunfire = !!sunfireAura;
      const sunfireRemaining = sunfireAura ? sunfireAura.remaining : 0;

      if (!hasSunfire) {
        priority = 100; // Highest priority - no Sunfire at all
      } else if (sunfireRemaining < 5000) {
        priority = 90; // Needs refresh
      }

      // Add time to death bonus for longer fights
      if (this.getTimeToDeath(enemy) > 20000) {
        priority += 10;
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestTarget = enemy;
      }
    }

    return bestTarget;
  }

  getBestMoonfireTarget() {
    const enemies = combat.targets.filter(enemy =>
      !enemy.deadOrGhost &&
      me.distanceTo(enemy) <= 40 &&
      this.getTimeToDeath(enemy) > 12000
    );

    // Priority: refreshable targets, then targets without Moonfire
    let bestTarget = null;
    let bestPriority = -1;

    for (const enemy of enemies) {
      let priority = 0;
      const moonfireAura = this.unitHasMoonfire(enemy);
      const hasMoonfire = !!moonfireAura;
      const moonfireRemaining = moonfireAura ? moonfireAura.remaining : 0;

      if (!hasMoonfire) {
        priority = 100; // Highest priority - no Moonfire at all
      } else if (moonfireRemaining < 5000) {
        priority = 90; // Needs refresh
      }

      // Add time to death bonus for longer fights
      if (this.getTimeToDeath(enemy) > 30000) {
        priority += 10;
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestTarget = enemy;
      }
    }

    return bestTarget;
  }

  // Ramp system methods
  handleRampSystem() {
    if (!Settings.UseRampSystem) return;

    // Check for keybind press
    if (KeyBinding.isPressed("RampKeybind")) {
      if (!this.rampModeActive) {
        // Start ramp
        this.rampModeActive = true;
        this.rampStartTime = wow.frameTime;
      } else {
        // Cancel ramp
        this.rampModeActive = false;
        this.rampStartTime = 0;
      }
    }

    // Handle ramp timeout
    if (this.rampModeActive && this.rampStartTime > 0) {
      const elapsed = (wow.frameTime - this.rampStartTime) / 1000;

      if (elapsed >= Settings.RampDuration) {
        this.rampModeActive = false;
        this.rampStartTime = 0;
      }
    }
  }

  mouseoverIsDeadFriend() {
    const mouseoverGuid = wow.GameUI.mouseOverGuid;
    if (mouseoverGuid && !mouseoverGuid.isNull) {
      try {
        const mouseover = mouseoverGuid.toUnit();
        if (mouseover) {
          return mouseover.deadOrGhost &&
            mouseover.inMyGroup() &&
            mouseover.guid !== me.guid &&
            me.withinLineOfSight(mouseover);
        }
      } catch (error) {
        // Invalid guid, return false
        return false;
      }
    }
    return false;
  }

  friendHasMotW(unit) {
    return unit.hasAura(auras.markOfTheWild) || unit.hasAura("Mark of the Wild");
  }

  getMarkOfTheWildTarget() {
    if (!this.friendHasMotW(me)) {
      return me;
    }

    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      friend.isPlayer() &&
      me.distanceTo(friend) <= 40 &&
      !this.friendHasMotW(friend)
    ) || null;
  }

  getSafeFriends() {
    // Get friends with proper safety checks to avoid .toUnit errors
    const safeFriends = [];

    try {
      heal.friends.All.forEach(friend => {
        if (this.isSafeFriend(friend)) {
          safeFriends.push(friend);
        }
      });
    } catch (error) {
      // If heal.friends.All has issues, return empty array
      return [];
    }

    return safeFriends;
  }

  isSafeFriend(friend) {
    try {
      // Test all properties that might cause errors
      return friend &&
             friend.deadOrGhost !== undefined &&
             !friend.deadOrGhost &&
             me.distanceTo(friend) <= 40 &&
             friend.hasAura !== undefined;
    } catch (error) {
      // If any property access fails, this friend is not safe
      return false;
    }
  }

  isSafeFriendATank(friend) {
    try {
      return heal.friends.Tanks.some(tank =>
        tank && tank.guid && friend.guid && tank.guid.equals(friend.guid)
      );
    } catch (error) {
      // If tank detection fails, assume not a tank
      return false;
    }
  }

  getSymbioticRelationshipTarget() {
    if (me.hasAuraByMe(474754)) {
      return;
    }
    // Prioritize tanks if they don't have it
    const tank = heal.friends.Tanks.find(tank =>
      tank &&
      !tank.deadOrGhost &&
      me.distanceTo(tank) <= 40 &&
      !tank.hasAuraByMe(auras.symbioticRelationship)
    );
    if (tank) return tank;

    // Otherwise any party member except me
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      !friend.hasAuraByMe(auras.symbioticRelationship) && !friend.hasAuraByMe("Symbiotic Relationship")
    ) || null;
  }

  getDeadAlliesInRange(range) {
    return heal.friends.All.filter(friend =>
      friend &&
      friend.deadOrGhost &&
      me.distanceTo(friend) <= range
    );
  }

  findFriendWithMythicDebuff() {
    return heal.friends.All.find(friend =>
      friend &&
      !friend.deadOrGhost &&
      me.distanceTo(friend) <= 40 &&
      friend.hasAura(440313)
    );
  }

  getFluidFormMeleeTarget() {
    // Find nearest enemy in combat with me or my tank within melee range (8 yards)
    const validTargets = me.getUnitsAround(8).filter(unit =>
      unit &&
      !unit.deadOrGhost &&
      me.canAttack(unit) &&
      !unit.isImmune() &&
      this.isEnemyInCombatWithMeOrTank(unit)
    );

    if (validTargets.length === 0) return null;
    console.info(`[RestoDruid] Valid targets: ${validTargets.length}`);

    // Return closest target
    return validTargets.sort((a, b) => me.distanceTo(a) - me.distanceTo(b))[0];
  }

  isEnemyInCombatWithMeOrTank(unit) {
    // Check if enemy is in combat with me
    console.info(`[RestoDruid] Unit: ${unit.name}, Me: ${me.name}`);
    console.info(`[RestoDruid] Unit in combat: ${unit.inCombat()}, Me in combat: ${me.inCombat()}`);
    console.info(`[RestoDruid] Unit in combat with me: ${unit.inCombatWith(me)}, Me in combat with unit: ${me.inCombatWith(unit)}`);
    if ((unit.inCombat() && unit.inCombatWith(me)) || (me.inCombat() && me.inCombatWith(unit) || unit.name.includes("Dummy"))) {
      return true;
    }

    // Check if enemy is in combat with any of our tanks
    return heal.friends.Tanks.some(tank =>
      tank &&
      !tank.deadOrGhost &&
      unit.inCombatWith &&
      unit.inCombatWith(tank)
    );
  }

  shouldCastRakeNext() {
    // Check if Rake would be the next ability we'd cast in cat form
    const target = this.getRakeTarget();
    if (!target) {
      if (Settings.CatWeavingDebug) {
        console.info(`[RestoDruid] shouldCastRakeNext - No rake target found`);
      }
      return false;
    }

    // Rake is next if target doesn't have Rake or it's expiring soon
    const rakeAura = target.getAuraByMe(auras.rake);
    if (!rakeAura) {
      if (Settings.CatWeavingDebug) {
        console.info(`[RestoDruid] shouldCastRakeNext - Target ${target.name} has no Rake, should cast`);
      }
      return true;
    }

    const remaining = this.getAuraRemainingTime(target, auras.rake);
    const shouldRefresh = remaining !== null && remaining <= 4500;
    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] shouldCastRakeNext - Target ${target.name} Rake remaining: ${remaining}ms, should refresh: ${shouldRefresh}`);
    }
    return shouldRefresh; // Refresh with 4.5s remaining
  }

  shouldCastShredNext() {
    // Check if Shred would be the next ability we'd cast in cat form
    const target = this.getCurrentTarget();
    if (!target) return false;

    // Shred is next if we have energy and combo points < 5
    const energy = me.powerByType(PowerType.Energy);
    const comboPoints = me.powerByType(PowerType.ComboPoints);

    // Check if we wouldn't cast Rake or Rip first
    const shouldRake = this.shouldCastRakeNext();
    if (shouldRake) return false;

    const ripTarget = this.getRipTarget();
    if (ripTarget && comboPoints >= 1) return false; // Would cast Rip first

    // Shred if we have energy and need combo points
    return energy >= 40 && comboPoints < 5;
  }

  isRakeTargetInMelee() {
    const target = this.getRakeTarget();
    return target && me.distanceTo(target) <= 8;
  }

  isCurrentTargetInMelee() {
    const target = this.getCurrentTarget();
    return target && me.distanceTo(target) <= 8 && this.isValidDPSTarget(target);
  }

  trackComboGenerator(spellName) {
    // Track when we cast a combo point generator
    this.lastComboGeneratorTime = Date.now();
    this.lastComboGeneratorSpell = spellName;
    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Tracked combo generator: ${spellName}`);
    }
  }

  recentlyGeneratedComboPoint() {
    // Check if we recently cast a combo point generator (within last 500ms)
    const timeSinceGenerator = Date.now() - this.lastComboGeneratorTime;
    return timeSinceGenerator <= 500 &&
           (this.lastComboGeneratorSpell === "Rake" ||
            this.lastComboGeneratorSpell === "Shred" ||
            this.lastComboGeneratorSpell === "Thrash");
  }

  canShiftForms() {
    // Check if enough time has passed since last form shift and we're not form-locked
    const timeSinceShift = Date.now() - this.lastFormShiftTime;
    const notFormLocked = !me.hasAuraByMe(432031); // Form-locking aura
    return timeSinceShift >= Settings.FormShiftDelay && notFormLocked;
  }

  trackFormShift() {
    // Track when we shift forms
    this.lastFormShiftTime = Date.now();
    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Form shift tracked`);
    }
  }

  trackCatFormEntry() {
    // Track when we enter cat form
    this.lastCatFormEntryTime = Date.now();
    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Cat form entry tracked`);
    }
  }

  canExitCatForm() {
    // Check if enough time has passed since entering cat form
    const timeSinceCatEntry = Date.now() - this.lastCatFormEntryTime;
    const canExit = timeSinceCatEntry >= Settings.MinCatFormDuration;

    if (Settings.CatWeavingDebug && !canExit && me.hasAuraByMe(auras.catForm)) {
      const remaining = Settings.MinCatFormDuration - timeSinceCatEntry;
      console.info(`[RestoDruid] Cannot exit cat form yet - ${remaining}ms remaining of minimum duration`);
    }

    return canExit;
  }

  isEmergencyHealing() {
    // Check if someone is at emergency healing threshold (much lower than normal)
    const emergencyFriends = this.getFriendsUnderHealthPercent(Settings.RegrowthEmergencyPct);
    return emergencyFriends.length > 0;
  }

  trackEmergencyHealing() {
    // Track when we do emergency healing
    this.lastEmergencyHealingTime = Date.now();
    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Emergency healing tracked`);
    }
  }

  canEnterCatFormAfterEmergency() {
    // Check if enough time has passed since emergency healing
    const timeSinceEmergency = Date.now() - this.lastEmergencyHealingTime;
    return timeSinceEmergency >= Settings.EmergencyHealingCooldown;
  }

  canCastEfflorescence() {
    // Check current Efflorescence state and update timing
    this.updateEfflorescenceState();

    // Check if enough time has passed since Efflorescence became ineffective
    const timeSinceIneffective = Date.now() - this.lastEfflorescenceIneffectiveTime;
    return timeSinceIneffective >= Settings.EfflorescenceDelay;
  }

  updateEfflorescenceState() {
    // Check if Efflorescence is currently effective (active and has people in it)
    const hasActiveEfflorescence = this.hasEfflorescenceActive();
    const friendsInEfflorescence = hasActiveEfflorescence ? this.getFriendsInEfflorescence().length : 0;
    const currentlyEffective = hasActiveEfflorescence && friendsInEfflorescence > 0;

    // If Efflorescence just became ineffective, start the delay timer
    if (this.lastEfflorescenceState === true && !currentlyEffective) {
      this.lastEfflorescenceIneffectiveTime = Date.now();
      if (Settings.CatWeavingDebug) {
        console.info(`[RestoDruid] Efflorescence became ineffective - starting delay timer`);
      }
    }

    this.lastEfflorescenceState = currentlyEffective;
  }

  shouldUseEfflorescence() {
    // Only use Efflorescence if we're in a party and there's a reason to heal

    // Check if we're in a group (more than just me)
    const partySize = heal.friends.All.length + 1; // +1 for me
    if (partySize < 2) {
      return false; // Solo play, no need for Efflorescence
    }

    // Check if someone needs healing
    const friendsNeedingHealing = this.getFriendsUnderHealthPercent(95); // Liberal threshold for Efflorescence
    const someoneNeedsHealing = friendsNeedingHealing.length > 0;

    // Check if anyone in party is in combat
    const meInCombat = me.inCombat();
    const partyInCombat = heal.friends.All.some(friend =>
      friend && !friend.deadOrGhost && friend.inCombat()
    );

    return someoneNeedsHealing || meInCombat || partyInCombat;
  }

  shouldSpendComboPointsBeforeExitingCat() {
    // Check if we have 5 combo points (or effectively have 5) and should spend them before exiting cat form
    const comboPoints = me.powerByType(PowerType.ComboPoints);
    const recentlyGeneratedCombo = this.recentlyGeneratedComboPoint();

    // Treat as having 5 combo points if we have 4 and just cast a generator
    const effectiveComboPoints = (comboPoints >= 4 && recentlyGeneratedCombo) ? 5 : comboPoints;

    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] shouldSpendComboPointsBeforeExitingCat - Actual CP: ${comboPoints}, Effective CP: ${effectiveComboPoints}, Recently generated: ${recentlyGeneratedCombo}`);
    }

    // Don't exit if we have (or effectively have) 5 combo points
    if (effectiveComboPoints >= 5) return true;

    // Check if we can cast Rip or Ferocious Bite (must be in melee range)
    const ripTarget = this.getRipTarget();
    const currentTarget = this.getCurrentTarget();

    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Rip target: ${ripTarget ? ripTarget.name : 'none'}, Rip ready: ${spell.getCooldown(1079).ready}`);
      console.info(`[RestoDruid] Current target: ${currentTarget ? currentTarget.name : 'none'}, Bite ready: ${spell.getCooldown(22568).ready}`);
      if (ripTarget) {
        console.info(`[RestoDruid] Rip target distance: ${me.distanceTo(ripTarget).toFixed(1)}y`);
      }
      if (currentTarget) {
        console.info(`[RestoDruid] Current target distance: ${me.distanceTo(currentTarget).toFixed(1)}y`);
      }
    }

    // Check Rip target (in melee range)
    if (ripTarget && spell.getCooldown(1079).ready && me.distanceTo(ripTarget) <= 8) return true;

    // Check current target for Ferocious Bite (in melee range)
    if (currentTarget && this.isValidDPSTarget(currentTarget) && spell.getCooldown(22568).ready && me.distanceTo(currentTarget) <= 8) return true;

    return false;
  }

  trySpendComboPoints() {
    // Try to spend 5 combo points on Rip or Ferocious Bite
    const comboPoints = me.powerByType(PowerType.ComboPoints);
    const recentlyGeneratedCombo = this.recentlyGeneratedComboPoint();

    // Treat as having 5 combo points if we have 4 and just cast a generator
    const effectiveComboPoints = (comboPoints >= 4 && recentlyGeneratedCombo) ? 5 : comboPoints;

    if (effectiveComboPoints < 5) return false;

    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] trySpendComboPoints - Actual CP: ${comboPoints}, Effective CP: ${effectiveComboPoints}, Recently generated: ${recentlyGeneratedCombo}`);
    }

    // Try Rip first (higher priority) - must be in melee range
    const ripTarget = this.getRipTarget();
    if (ripTarget && spell.getCooldown(1079).ready && me.distanceTo(ripTarget) <= 8) {
      const ripSpell = spell.getSpell(1079);
      if (ripSpell) {
        if (Settings.CatWeavingDebug) {
          console.info(`[RestoDruid] Casting Rip on ${ripTarget.name}`);
        }
        return spell.castPrimitive(ripSpell, ripTarget);
      }
    }

    // Try Ferocious Bite as fallback - must be in melee range
    const currentTarget = this.getCurrentTarget();
    if (currentTarget && this.isValidDPSTarget(currentTarget) && spell.getCooldown(22568).ready && me.distanceTo(currentTarget) <= 8) {
      const biteSpell = spell.getSpell(22568);
      if (biteSpell) {
        if (Settings.CatWeavingDebug) {
          console.info(`[RestoDruid] Casting Ferocious Bite on ${currentTarget.name}`);
        }
        return spell.castPrimitive(biteSpell, currentTarget);
      }
    }

    if (Settings.CatWeavingDebug) {
      console.info(`[RestoDruid] Could not spend combo points - no valid targets in range`);
    }
    return false;
  }

  // Burst system methods
  handleBurstToggle() {
    if (!Settings.UseBurstToggle) return;

    // Check for keybind press using the KeyBinding system
    if (KeyBinding.isPressed("BurstToggleKeybind")) {

      if (!Settings.BurstModeWindow) {
        // Toggle mode: flip the state
        combat.burstToggle = !combat.burstToggle;
        this.burstModeActive = combat.burstToggle;
      } else {
        // Window mode: start the burst window
        combat.burstToggle = true;
        this.burstModeActive = true;
        this.burstToggleTime = wow.frameTime;
      }
    }

    // Handle burst window timeout - always check if we're in window mode and burst is active
    if (Settings.BurstModeWindow && combat.burstToggle && this.burstToggleTime > 0) {
      const elapsed = (wow.frameTime - this.burstToggleTime) / 1000;

      if (elapsed >= Settings.BurstWindowDuration) {
        combat.burstToggle = false;
        this.burstModeActive = false;
        this.burstToggleTime = 0; // Reset the timer
      }
    }
  }

  shouldUseBurstAbility() {
    if (Settings.UseBurstToggle) {
      return combat.burstToggle;
    }
    // Legacy burst mode
    return this.burstModeActive;
  }

  renderOverlay() {
    // Safety check
    if (!me) return;

    if (!this.overlayToggles.showOverlay.value) {
      return;
    }

    const viewport = imgui.getMainViewport();
    if (!viewport) {
      return;
    }

    const workPos = viewport.workPos;
    const workSize = viewport.workSize;

    // Position overlay in top-right corner
    const overlaySize = { x: 300, y: 400 };
    const overlayPos = {
      x: workPos.x + workSize.x - overlaySize.x - 20,
      y: workPos.y + 20
    };

    imgui.setNextWindowPos(overlayPos, imgui.Cond.FirstUseEver);
    imgui.setNextWindowSize(overlaySize, imgui.Cond.FirstUseEver);

    // Make background more opaque
    imgui.setNextWindowBgAlpha(0.30);

    // Window flags for overlay behavior
    const windowFlags =
      imgui.WindowFlags.NoResize |
      imgui.WindowFlags.AlwaysAutoResize;

    if (imgui.begin("Resto Druid Controls", this.overlayToggles.showOverlay, windowFlags)) {

      // Ramp Status
      if (imgui.collapsingHeader("Ramp System", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();

        if (this.rampModeActive) {
          const elapsed = (wow.frameTime - this.rampStartTime) / 1000;
          const remaining = Math.max(0, Settings.RampDuration - elapsed);
          const statusText = `RAMP ACTIVE (${remaining.toFixed(1)}s remaining)`;
          imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, statusText);

          if (imgui.button("Cancel Ramp", { x: 120, y: 0 })) {
            this.rampModeActive = false;
            this.rampStartTime = 0;
          }
        } else {
          const keyName = KeyBinding.formatKeyBinding(KeyBinding.keybindings["RampKeybind"]) || "F1";
          imgui.text(`Press ${keyName} to start ramp cycle`);

          if (imgui.button("Start Ramp", { x: 120, y: 0 })) {
            this.rampModeActive = true;
            this.rampStartTime = wow.frameTime;
          }
        }

        imgui.unindent();
      }

      // Controls section
      if (imgui.collapsingHeader("Controls", imgui.TreeNodeFlags.DefaultOpen)) {
        imgui.indent();

        imgui.checkbox("Healing", this.overlayToggles.healing);
        imgui.checkbox("Cooldowns", this.overlayToggles.cooldowns);
        imgui.checkbox("DPS", this.overlayToggles.dps);
        imgui.checkbox("Interrupts", this.overlayToggles.interrupts);

        imgui.unindent();
      }

      // Group Status
      if (imgui.collapsingHeader("Group Status")) {
        imgui.indent();

        const lowestAlly = this.getLowestHealthAlly();
        if (lowestAlly) {
          const healthColor = lowestAlly.effectiveHealthPercent <= 50 ?
            { r: 1.0, g: 0.2, b: 0.2, a: 1.0 } :
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
          imgui.textColored(healthColor, `Lowest: ${lowestAlly.unsafeName} (${lowestAlly.effectiveHealthPercent.toFixed(1)}%)`);
        }

        const friendsNeedingHealing = this.getFriendsUnderHealthPercent(80);
        imgui.text(`Friends < 80%: ${friendsNeedingHealing.length}`);

        const manaPct = (me.powerByType(PowerType.Mana) / me.maxPowerByType(PowerType.Mana) * 100);
        const manaColor = manaPct <= 30 ?
          { r: 1.0, g: 0.2, b: 0.2, a: 1.0 } :
          { r: 0.2, g: 0.2, b: 1.0, a: 1.0 };
        imgui.textColored(manaColor, `Mana: ${manaPct.toFixed(1)}%`);

        imgui.unindent();
      }

      // Burst Status
      if (imgui.collapsingHeader("Burst System")) {
        imgui.indent();

        if (Settings.UseBurstToggle) {
          if (combat.burstToggle) {
            const statusText = Settings.BurstModeWindow ?
              `BURST WINDOW ACTIVE (${Math.max(0, Settings.BurstWindowDuration - Math.floor((wow.frameTime - this.burstToggleTime) / 1000))}s)` :
              "BURST TOGGLE ACTIVE";
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, statusText);
            if (imgui.button("Disable Burst", { x: 120, y: 0 })) {
              combat.burstToggle = false;
              this.burstModeActive = false;
              this.burstToggleTime = 0;
            }
          } else {
            const keyName = KeyBinding.formatKeyBinding(KeyBinding.keybindings["BurstToggleKeybind"]) || "X";
            imgui.text(`Press ${keyName} to ${Settings.BurstModeWindow ? "start burst window" : "toggle burst"}`);
            if (imgui.button("Enable Burst", { x: 120, y: 0 })) {
              combat.burstToggle = true;
              this.burstModeActive = true;
              if (Settings.BurstModeWindow) {
                this.burstToggleTime = wow.frameTime;
              }
            }
          }
        } else {
          imgui.textColored({ r: 0.6, g: 0.6, b: 0.6, a: 1.0 }, "Burst Toggle Disabled");
        }

        imgui.unindent();
      }

      // DPS Status
      if (imgui.collapsingHeader("DPS Status")) {
        imgui.indent();

        const currentTarget = this.getCurrentTarget();
        if (currentTarget) {
          imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, `Target: ${currentTarget.unsafeName}`);
          imgui.text(`Health: ${currentTarget.effectiveHealthPercent.toFixed(1)}%`);

          // Show DoT status
          const hasSunfire = !!(this.unitHasSunfire(currentTarget) || currentTarget.hasAura("Sunfire"));
          const hasMoonfire = !!(this.unitHasMoonfire(currentTarget) || currentTarget.hasAura("Moonfire"));
          const sunfireColor = hasSunfire ? { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.6, b: 0.2, a: 1.0 };
          const moonfireColor = hasMoonfire ? { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.6, b: 0.2, a: 1.0 };

          imgui.textColored(sunfireColor, `Sunfire: ${hasSunfire ? "Yes" : "No"}`);
          imgui.textColored(moonfireColor, `Moonfire: ${hasMoonfire ? "Yes" : "No"}`);
        } else {
          imgui.textColored({ r: 1.0, g: 0.6, b: 0.2, a: 1.0 }, "No Target");
        }

        // Cat Form status
        if (Settings.UseCatWeaving) {
          const inCatForm = me.hasAuraByMe(auras.catForm);
          const catFormColor = inCatForm ? { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          const energyColor = me.powerByType(PowerType.Energy) >= Settings.CatFormEnergyThreshold ?
            { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 1.0, g: 0.6, b: 0.2, a: 1.0 };

          imgui.textColored(catFormColor, `Cat Form: ${inCatForm ? "Active" : "Inactive"}`);
          imgui.textColored(energyColor, `Energy: ${me.powerByType(PowerType.Energy)}/${me.maxPowerByType(PowerType.Energy)}`);
          imgui.text(`Combo Points: ${me.powerByType(PowerType.ComboPoints)}/5`);

          const hasFluidForm = this.hasTalent("Fluid Form");
          const fluidFormColor = hasFluidForm ? { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.textColored(fluidFormColor, `Fluid Form: ${hasFluidForm ? "Yes" : "No"}`);

          const hasProwl = me.hasAuraByMe(auras.prowl);
          const prowlColor = hasProwl ? { r: 0.2, g: 1.0, b: 0.2, a: 1.0 } : { r: 0.6, g: 0.6, b: 0.6, a: 1.0 };
          imgui.textColored(prowlColor, `Prowl: ${hasProwl ? "Active" : "Inactive"}`);
          imgui.text(`In Combat: ${me.inCombat() ? "Yes" : "No"}`);
        }

        imgui.unindent();
      }

      // Manual spell casting section
      if (imgui.collapsingHeader("Manual Spell Casting")) {
        imgui.indent();

        imgui.text("Spell ID:");
        imgui.sameLine();
        imgui.setNextItemWidth(80);
        imgui.inputText("##spellId", this.spellIdInput);

        // Show spell name for current ID
        const currentSpellId = parseInt(this.spellIdInput.value, 10);
        if (currentSpellId > 0) {
          const currentSpellObject = spell.getSpell(currentSpellId);
          if (currentSpellObject) {
            const spellName = currentSpellObject.name || "Unknown Spell";
            imgui.textColored({ r: 0.2, g: 1.0, b: 0.2, a: 1.0 }, `"${spellName}"`);
          } else {
            imgui.textColored({ r: 1.0, g: 0.2, b: 0.2, a: 1.0 }, "Invalid Spell ID");
          }
        }

        imgui.text("Press RightArrow to cast");

        imgui.unindent();
      }

      imgui.end();
    }
  }
}

