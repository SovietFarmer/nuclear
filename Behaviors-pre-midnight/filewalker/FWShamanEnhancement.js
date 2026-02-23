
import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from "@/Core/Settings";
import CombatTimer from '@/Core/CombatTimer';
import objMgr from "@/Core/ObjectManager";
import { me } from '@/Core/ObjectManager';
import Pet from "@/Core/Pet";
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

// STATUS : DONE


const auras = {
  maelstromweapon: 344179,
  legacyfrostwitch: 384451,
  hothand: 215785,
  crashlightning: 187878,
  primordialwave: 375982,
  primordialstorm: 375982,
  ascendance: 114051,
  doomwinds: 384352,
  electrostatic: 378286, // Electrostatic Wager aura
  arcDischarge: 384359, // Arc Discharge aura
  stormblast: 319930,
  hailstorm: 334195,
  feralspirits: 333957,
  convergingstorms: 384363,
  whirlingair: 453409,
};

export class EnhancementShamanNewBehavior extends Behavior {
  name = 'FW Enhancement Shaman';
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Enhancement;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Rotation",
      options: [
        { type: "checkbox", uid: "ShamanEnhancerUseFunnel", text: "Use Funnel Rotation", default: false },
        { type: "checkbox", uid: "ShamanEnhancerUseTotemicHero", text: "Use Totemic Hero Talents", default: true },
      ]
    },
    {
      header: "Cooldowns",
      options: [
        { type: "checkbox", uid: "ShamanEnhancerUseCooldown", text: "Use Major Cooldowns", default: true },
        { type: "checkbox", uid: "ShamanEnhancer4Set", text: "Use Tier Set Bonuses", default: true },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "checkbox", uid: "ShamanEnhancerUseAstralShift", text: "Use Astral Shift", default: true },
        { type: "checkbox", uid: "ShamanEnhancerSelfheal", text: "Use Self-Heal", default: true },
        { type: "slider", uid: "ShamanEnhancerSelfhealPercentage", text: "Self-Heal Percentage", min: 1, max: 100, default: 20 },
      ]
    }
  ];

  build() {
    
    console.debug('COMBATTIME: '+ CombatTimer.getCombatStartTime());
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      
      new bt.Action(() => (this.getCurrentTarget() === null ? bt.Status.Success : bt.Status.Failure)),
      common.waitForTarget(),
      common.waitForFacing(),
      common.waitForCastOrChannel(),
      
      this.manageSurgingTotem(),


      // Precombat actions
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Interrupt
          spell.interrupt('Wind Shear'),
          
          // Precombat buffs
          spell.cast('Lightning Shield', on => me, req => !me.hasAura('Lightning Shield')),
          spell.cast('Windfury Weapon', on => me, req => !me.hasAura('Windfury Weapon')),
          spell.cast('Flametongue Weapon', on => me, req => !me.hasAura('Flametongue Weapon')),
          spell.cast('Skyfury', on => me, req => !me.hasAura('Skyfury')),
          
          // Defensive actions
          this.defensives(),
          
          // Combat rotation selector based on settings and context
          new bt.Selector(
            // Funnel rotation (multiple targets but focusing damage)
            new bt.Decorator(
              req => this.shouldUseFunnel() && me.isWithinMeleeRange(this.getCurrentTarget()),
              this.funnelRotation()
            ),
            
            // AoE Totemic opener
            new bt.Decorator(
              req => me.isWithinMeleeRange(this.getCurrentTarget()) && 
                this.getEnemiesInRange(8) >= 3 && 
                this.hasTalent('Surging Totem') && 
                this.hasCooldownsReady() && 
                this.useCooldowns() &&
                this.shouldUseTotemicHero() &&
                this.isOpeningPhase(),
              this.multiTargetTotemicOpen()
            ),
            
            // AoE Totemic sustained
            new bt.Decorator(
              req => me.isWithinMeleeRange(this.getCurrentTarget()) && 
                this.getEnemiesInRange(8) >= 3 && 
                this.hasTalent('Surging Totem') &&
                this.shouldUseTotemicHero(),
              this.multiTargetTotemic()
            ),
            
            // Single target Totemic opener
            new bt.Decorator(
              req => me.isWithinMeleeRange(this.getCurrentTarget()) && 
                this.getEnemiesInRange(8) < 3 && 
                this.hasTalent('Surging Totem') && 
                this.hasCooldownsReady() && 
                this.useCooldowns() &&
                this.shouldUseTotemicHero() &&
                this.isOpeningPhase(),
              this.singleTargetTotemicOpen()
            ),
            
            // Single target Totemic sustained
            new bt.Decorator(
              req => me.isWithinMeleeRange(this.getCurrentTarget()) && 
                this.hasTalent('Surging Totem') &&
                this.shouldUseTotemicHero(),
              this.singleTargetTotemic()
            ),
            
            // AoE standard opener
            new bt.Decorator(
              req => this.getEnemiesInRange(8) >= 3 && 
                !this.hasTalent('Surging Totem') && 
                this.hasCooldownsReady() && 
                this.useCooldowns() &&
                this.isOpeningPhase(),
              this.multiTargetOpen()
            ),
            
            // AoE standard sustained
            new bt.Decorator(
              req => this.getEnemiesInRange(8) >= 3 && 
                me.isWithinMeleeRange(this.getCurrentTarget()) && 
                !this.hasTalent('Surging Totem'),
              this.multiTarget()
            ),
            
            // Single target standard opener
            new bt.Decorator(
              req => this.getEnemiesInRange(8) < 3 && 
                !this.hasTalent('Surging Totem') && 
                this.hasCooldownsReady() && 
                this.useCooldowns() &&
                this.isOpeningPhase(),
              this.singleTargetOpen()
            ),
            
            // Single target standard sustained
            new bt.Decorator(
              req => me.isWithinMeleeRange(this.getCurrentTarget()),
              this.singleTarget()
            ),
            
            // Auto attack fallback
            spell.cast('Auto Attack', this.getCurrentTarget, req => true)
          )
        )
      )
    );
  }

  // Utility methods
  
  shouldUseTotemicHero() {
    return Settings.ShamanEnhancerUseTotemicHero === true;
  }
  
  useCooldowns() {
    return Settings.ShamanEnhancerUseCooldown === true;
  }
  
  hasCooldownsReady() {
    return (
      spell.getCooldown('Feral Spirit').ready ||
      spell.getCooldown('Doom Winds').ready ||
      spell.getCooldown('Ascendance').ready
      
    );
  }

  shouldUseFunnel() {
    return Settings.ShamanEnhancerUseFunnel && 
           this.getEnemiesInRange(10) > 1 && 
           me.hasAura('Primordial Wave');
  }
  
  isOpeningPhase() {
    return CombatTimer.getCombatStartTime() < 20000;
  }
  
  // Defensive rotation
  defensives() {
    return new bt.Selector(
      spell.cast('Astral Shift', on => me, req => 
        Settings.ShamanEnhancerUseAstralShift && me.pctHealth <= 50
      ),
      spell.cast('Healing Surge', on => me, req =>
        Settings.ShamanEnhancerSelfheal && 
        me.pctHealth <= Settings.ShamanEnhancerSelfhealPercentage && 
        me.getAuraStacks(auras.maelstromweapon) >= 5
      )
    );
  }

  // Funnel rotation - focused on Lightning Bolt/Chain Lightning with Maelstrom
  funnelRotation() {
    return new bt.Selector(
      // Use trinkets and racials
      this.useRacials(),
      this.useTrinkets(),
      
      // Main Funnel rotation from APL
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        this.hasTalent('Elemental Spirits')
      ),
      
      spell.cast(444995, this.getCurrentTarget, req =>
        this.hasTalent('Surging Totem') && spell.getSpell('Surging Totem').overrideId == 444995
      ),
      
      spell.cast('Ascendance', this.getCurrentTarget),
      
      spell.cast('Windstrike', this.getCurrentTarget, req =>
        (this.hasTalent('Thorims Invocation') && me.getAuraStacks(auras.maelstromweapon) > 0) ||
        me.getAuraStacks('Converging Storms') >= 6
      ),
      
      spell.cast('Tempest', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) === 10 ||
        (me.getAuraStacks(auras.maelstromweapon) >= 5 && me.getAuraStacks('Awakening Storms') === 2)
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6) &&
        me.hasAura('Primordial Wave') &&
        me.getAuraStacks(auras.maelstromweapon) === 10 &&
        (!me.hasAura('Splintered Elements') || this.fightRemains() <= 12)
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5 &&
        this.hasTalent('Elemental Spirits') &&
        this.feralSpiritActive() >= 4
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        this.hasTalent('Supercharge') &&
        me.getAuraStacks(auras.maelstromweapon) === 10 &&
        this.expectedLbFunnel() > this.expectedClFunnel()
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        (this.hasTalent('Supercharge') && me.getAuraStacks(auras.maelstromweapon) === 10) ||
        (me.hasAura('Arc Discharge') && me.getAuraStacks(auras.maelstromweapon) >= 5)
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        (this.hasTalent('Molten Assault') && this.getCurrentTarget().hasAura('Flame Shock') && 
         this.activeDotCount('Flame Shock') < this.activeEnemiesCount() && this.activeDotCount('Flame Shock') < 6) ||
        (this.hasTalent('Ashen Catalyst') && me.getAuraStacks('Ashen Catalyst') === 10)
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        !me.hasAura('Primordial Wave')
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        (!this.hasTalent('Elemental Spirits') || 
         (this.hasTalent('Elemental Spirits') && 
          (spell.getCharges('Elemental Blast') === spell.getMaxCharges('Elemental Blast') || me.hasAura(auras.feralspirits)))) &&
        me.getAuraStacks(auras.maelstromweapon) === 10
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget),
      spell.cast('Doom Winds', this.getCurrentTarget),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.getAuraStacks('Converging Storms') === 6
      ),
      
      spell.cast('Lava Burst', this.getCurrentTarget, req =>
        (me.getAuraStacks('Molten Weapon') > me.getAuraStacks('Crackling Surge')) &&
        me.getAuraStacks(auras.maelstromweapon) === 10
      ),
      
      // Continue with standard abilities
      this.standardAbilities()
    );
  }

  // Multi target action list for Totemic opener
  multiTargetTotemicOpen() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
      
      spell.cast(444995, this.getCurrentTarget, req => spell.getSpell('Surging Totem').overrideId == 444995),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.hasTalent('Swirling Maelstrom') &&
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 8
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        (me.getAuraStacks('Electrostatic Wager') > 9 && me.hasAura('Doom Winds')) ||
        !me.hasAura('Crash Lightning')
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 8
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        me.hasAura('Hot Hand') ||
        (me.hasAura(auras.legacyfrostwitch) && me.hasAura('Whirling Fire'))
      ),
      
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') &&
        me.hasAura('Hailstorm') &&
        this.searingTotemActive()
      ),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.searingTotemActive() &&
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Ice Strike', this.getCurrentTarget),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) < 10 &&
        !me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget)
    );
  }

  // Multi target action list for Totemic sustained
  multiTargetTotemic() {
    return new bt.Selector(
      // If in opening phase or certain cooldowns are available, use the opener
      new bt.Decorator(
        req => (spell.getCooldown('Doom Winds').ready || 
                // spell.getCooldown('Sundering').ready || 
                !me.hasAura('Hot Hand')) &&
               this.isOpeningPhase(),
        this.multiTargetTotemicOpen()
      ),
      this.useRacials(),
      this.useTrinkets(),
      spell.cast(444995, this.getCurrentTarget, req => spell.getSpell('Surging Totem').overrideId == 444995),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        this.canTiChainLightning()
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.hasTalent('Ashen Catalyst') || this.hasTalent('Primordial Wave'))
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        this.hasTalent('Crashing Storms') &&
        this.getEnemiesInRange(8) >= (15 - 5 * (this.hasTalent('Unruly Winds') ? 1 : 0))
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        ((spell.getCooldown('Doom Winds').timeleft > 30000 || spell.getCooldown('Doom Winds').timeleft < 7000) &&
         (spell.getCooldown('Primordial Wave').timeleft < 2000 || me.hasAura('Primordial Storm') || !this.hasTalent('Primordial Storm')))
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        !this.hasTalent('Elemental Spirits')
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        spell.getCooldown('Doom Winds').timeleft > 3000
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        (!this.hasTalent('Elemental Spirits') || 
         (this.hasTalent('Elemental Spirits') && 
          (spell.getSpell('Elemental Blast').charges.charges === spell.getSpell('Elemental Blast').charges.maxcharges || 
           this.feralSpiritActive() >= 2))) &&
        me.getAuraStacks(auras.maelstromweapon) === 10 &&
        (!this.hasTalent('Crashing Storms') || this.getEnemiesInRange(8) <= 3)
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        me.hasAura(auras.hothand)
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks('Electrostatic Wager') > 8
      ),
      
      // Rest of the abilities for sustained AoE
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') || 
        (this.hasTalent('Earthsurge') && 
         (me.hasAura(auras.legacyfrostwitch) || !this.hasTalent(auras.legacyfrostwitch)) &&
         this.surgingTotemActive() > 0)
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        me.getAuraStacks('Electrostatic Wager') > 4 &&
        !me.hasAura('CL Crash Lightning') &&
        me.hasAura('Doom Winds')
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        !me.hasAura('Primordial Storm')
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') ||
        !me.hasAura('Crash Lightning') ||
        (this.hasTalent('Alpha Wolf') && this.feralSpiritActive() > 0 && this.alphaWolfMinRemains() === 0)
      ),
      
      spell.cast('Voltaic Blaze', this.getCurrentTarget),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6) &&
        this.searingTotemActive()
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        this.hasTalent('Molten Assault') && this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') && me.hasAura('Hailstorm') && this.searingTotemActive()
      ),
      
      // Standard abilities for AoE situation
      this.standardAoeAbilities()
    );
  }

  // Single target action list for Totemic opener
  singleTargetTotemicOpen() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        !me.hasAura('Surging Totem') &&
        this.hasTalent('Lashing Flames') &&
        !this.getCurrentTarget().hasAura('Lashing Flames')
      ),
      
      spell.cast(444995, this.getCurrentTarget, req => spell.getSpell('Surging Totem').overrideId == 444995),
      
      spell.cast('Primordial Wave', this.getCurrentTarget),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req => me.hasAura(auras.legacyfrostwitch)),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        me.hasAura(auras.hothand)
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') &&
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) === 10
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget),
      
      spell.cast('Lava Lash', this.getCurrentTarget)
    );
  }

  // Single target action list for Totemic sustained
  // Multi target standard opener
  multiTargetOpen() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
  
      // Flame Shock if not ticking
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
  
      // Crash Lightning with conditions
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        (me.getAuraStacks('Electrostatic Wager') > 9 && me.hasAura('Doom Winds')) || 
        !me.hasAura('Crash Lightning')
      ),
  
      // Voltaic Blaze for flame shock spreading
      spell.cast('Voltaic Blaze', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') < 3
      ),
  
      // Lava Lash for flame shock spreading
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        this.hasTalent('Molten Assault') &&
        (this.hasTalent('Primordial Wave') || this.hasTalent('Fire Nova')) &&
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') < this.activeEnemiesCount()) &&
        this.activeDotCount('Flame Shock') < 3
      ),
  
      // Primordial Wave for buff
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 4 &&
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
  
      // Major cooldowns
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9
      ),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        (this.getCurrentTarget().hasAura('Flame Shock') || !this.hasTalent('Molten Assault')) &&
        this.canTiChainLightning() &&
        (me.hasAura(auras.legacyfrostwitch) || !this.hasTalent('Legacy of the Frost Witch')) &&
        !me.hasAura('Doom Winds')
      ),
      
      // Maelstrom spenders
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9 &&
        (me.hasAura(auras.legacyfrostwitch) || !this.hasTalent('Legacy of the Frost Witch'))
      ),
      
      spell.cast('Tempest', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9 &&
        !me.getAuraStacks('Arc Discharge') > 0
      ),
      
      // Core rotational abilities
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks('Electrostatic Wager') > 4
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget, req =>
        this.hasTalent('Thorims Invocation') && this.canTiChainLightning()
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5 &&
        (!me.hasAura('Primordial Storm') || !me.hasAura('Legacy of the Frost Witch')) &&
        me.hasAura('Doom Winds')
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9 &&
        (!me.hasAura('Primordial Storm') || !me.hasAura('Legacy of the Frost Witch'))
      ),
      
      // Final abilities
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.getAuraStacks('Converging Storms') === 6 && me.getAuraStacks('Stormblast') > 1
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget),
      spell.cast('Voltaic Blaze', this.getCurrentTarget),
      spell.cast('Stormstrike', this.getCurrentTarget)
    );
  }

  // Multi target standard sustained
  multiTarget() {
    return new bt.Selector(
      // If in opening phase, use the opener
      new bt.Decorator(
        req => this.isOpeningPhase(),
        this.multiTargetOpen()
      ),
      
      // Major cooldowns
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        this.hasTalent('Elemental Spirits') || this.hasTalent('Alpha Wolf')
      ),
      
      // Core rotational abilities
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        this.hasTalent('Molten Assault') && !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        (this.getCurrentTarget().hasAura('Flame Shock') || !this.hasTalent('Molten Assault')) && 
        this.canTiChainLightning()
      ),
      
      spell.cast('Tempest', this.getCurrentTarget, req =>
        !me.getAuraStacks('Arc Discharge') >= 1 && 
        ((me.getAuraStacks(auras.maelstromweapon) === 10 && !this.hasTalent('Raging Maelstrom')) || 
         (me.getAuraStacks(auras.maelstromweapon) >= 9)) ||
        (me.getAuraStacks(auras.maelstromweapon) >= 5)
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        spell.getCooldown('Doom Winds').timeleft > 30000 || spell.getCooldown('Doom Winds').timeleft < 7000
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock') && 
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 && 
        (me.hasAura('Doom Winds') || spell.getCooldown('Doom Winds').timeleft > 15000 || 
         this.getAuraRemainingTime('Primordial Storm') < 3000)
      ),
      
      // AOE rotational abilities
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        (this.hasTalent('Converging Storms') && me.getAuraStacks('Electrostatic Wager') > 6) || 
        !me.hasAura('Crash Lightning')
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget, req =>
        this.hasTalent('Thorims Invocation') && 
        me.getAuraStacks(auras.maelstromweapon) > 0 && 
        this.canTiChainLightning()
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        this.hasTalent('Converging Storms') && this.hasTalent('Alpha Wolf')
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.getAuraStacks('Converging Storms') === 6 && 
        me.getAuraStacks('Stormblast') > 0 && 
        me.hasAura(auras.legacyfrostwitch) && 
        me.getAuraStacks(auras.maelstromweapon) <= 8
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) <= 8
      ),
      
      spell.cast('Voltaic Blaze', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) <= 8
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5 && 
        !me.hasAura('Primordial Storm') && 
        (spell.getCooldown('Crash Lightning').timeleft >= 1000 || !this.hasTalent('Alpha Wolf'))
      ),
      
      // Additional abilities
      this.standardAoeAbilities()
    );
  }

  // Single target standard opener
  singleTargetOpen() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Voltaic Blaze', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') < 3 && !me.hasAura('Ascendance')
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 4 &&
        this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.activeDotCount('Flame Shock') === this.activeEnemiesCount() || this.activeDotCount('Flame Shock') === 6)
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9 &&
        (me.hasAura(auras.legacyfrostwitch) || !this.hasTalent('Legacy of the Frost Witch'))
      ),
      
      // Core rotational abilities
      spell.cast('Windstrike', this.getCurrentTarget),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Tempest', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        Settings.ShamanEnhancer4Set
      ),
      
      spell.cast('Voltaic Blaze', this.getCurrentTarget),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        this.hasTalent('Elemental Assault') &&
        this.hasTalent('Molten Assault') &&
        this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Ice Strike', this.getCurrentTarget)
    );
  }

  // Single target standard sustained
  singleTarget() {
    return new bt.Selector(
      // If in opening phase, use the opener
      new bt.Decorator(
        req => this.isOpeningPhase(),
        this.singleTargetOpen()
      ),
      this.useRacials(),
      this.useTrinkets(),
      // Primordial Storm management
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 ||
        (this.getAuraRemainingTime('Primordial Storm') <= 4000 && me.getAuraStacks(auras.maelstromweapon) >= 5)
      ),
      
      // DoT management
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.hasTalent('Ashen Catalyst') || this.hasTalent('Primordial Wave') || this.hasTalent('Lashing Flames'))
      ),
      
      // Major cooldowns
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        spell.getCooldown('Doom Winds').timeleft > 30000 || spell.getCooldown('Doom Winds').timeleft < 7000
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget, req =>
        this.hasTalent('Thorims Invocation') && me.getAuraStacks(auras.maelstromweapon) > 0 && this.canTiLightningBolt()
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch) &&
        (spell.getCooldown('Feral Spirit').timeleft > 30000 || spell.getCooldown('Feral Spirit').timeleft < 2000)
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock') ||
        !this.hasTalent('Primordial Wave') ||
        !this.hasTalent('Ashen Catalyst')
      ),
      
      // Maelstrom spenders
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        ((!this.hasTalent('Overflowing Maelstrom') && me.getAuraStacks(auras.maelstromweapon) >= 5) || 
         me.getAuraStacks(auras.maelstromweapon) >= 9)
      ),
      
      spell.cast('Tempest', this.getCurrentTarget, req =>
        me.hasAura('Tempest') && me.getAuraStacks(auras.maelstromweapon) >= 9
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 9 &&
        !me.hasAura('Primordial Storm') &&
        me.getAuraStacks('Arc Discharge') > 1
      ),
      
      spell.cast("Lava Lash", () => (me.hasAura("Hot Hand") && (me.getAuraStacks("Ashen Catalyst") === me.getMaxAuraStacks("Ashen Catalyst"))) || 
        (this.getCurrentTarget().getAura("Flame Shock") && this.getCurrentTarget().getAura("Flame Shock").remaining <= 2 && !this.hasTalent("Voltaic Blaze")) || 
        (this.hasTalent("Lashing Flames") && (!this.getCurrentTarget().hasAura("Lashing Flames")))),
      
      spell.cast("Crash Lightning", () => (me.hasAura("Doom Winds") && me.getAuraStacks("Electrostatic Wager") > 1) || me.getAuraStacks("Electrostatic Wager") > 8),
      
      spell.cast("Stormstrike", () => me.hasAura("Doom Winds") || me.getAuraStacks("Stormblast") > 0),
      
      spell.cast("Crash Lightning", () => this.hasTalent("Unrelenting Storms") && this.hasTalent("Alpha Wolf") && this.alphaWolfMinRemains() === 0),
      
      spell.cast("Lava Lash", () => me.hasAura("Hot Hand")),
      
      spell.cast("Crash Lightning", () => this.hasSetBonus("tww2_4pc")),
      
      spell.cast("Voltaic Blaze"),
      
      spell.cast("Stormstrike"),
      
      spell.cast("Lava Lash", () => this.hasTalent("Elemental Assault") && this.hasTalent("Molten Assault") && this.getCurrentTarget().hasAuraByMe("Flame Shock")),
      
      spell.cast("Ice Strike"),
      
      spell.cast("Lightning Bolt", () => me.getAuraStacks("Maelstrom Weapon") >= 5 && !me.hasAura("Primordial Storm")),
      
      spell.cast("Frost Shock", () => me.hasAura("Hailstorm")),
      
      spell.cast("Flame Shock", () => !this.getCurrentTarget().hasAuraByMe("Flame Shock")),
      
      spell.cast("Sundering"),
      
      spell.cast("Crash Lightning"),
      
      spell.cast("Frost Shock"),
      
      spell.cast("Fire Nova", () => this.getCurrentTarget().hasAuraByMe("Flame Shock")),
      
      spell.cast("Earth Elemental"),
      
      spell.cast("Flame Shock"),
      
      // Standard abilities
      this.standardSingleTargetAbilities()
    );
  }

  // Helper method for single target totemic sustained rotation
  singleTargetTotemic() {
    console.debug('DOOMWINDS CD: '+ spell.getCooldown('Doom Winds').timeleft);
    return new bt.Selector(
      // If in opening phase, use the opener
      new bt.Decorator(
        req => this.isOpeningPhase(),
        this.singleTargetTotemicOpen()
      ),
      this.useRacials(),
      this.useTrinkets(),
      spell.cast(444995, this.getCurrentTarget, req => spell.getSpell('Surging Totem').overrideId == 444995),
      
      spell.cast('Ascendance', this.getCurrentTarget, req =>
        this.canTiLightningBolt() &&
        this.surgingTotemActive() > 4000 &&
        (me.getAuraStacks('Totemic Rebound') >= 3 || me.getAuraStacks(auras.maelstromweapon) > 0)
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock') &&
        (this.hasTalent('Ashen Catalyst') || this.hasTalent('Primordial Wave'))
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        me.hasAura(auras.hothand)
      ),
      
      spell.cast('Feral Spirit', this.getCurrentTarget, req =>
        ((spell.getCooldown('Doom Winds').timeleft > 23000 || spell.getCooldown('Doom Winds').timeleft < 7000) &&
         (spell.getCooldown('Primordial Wave').timeleft < 20000 || me.hasAura('Primordial Storm') || !this.hasTalent('Primordial Storm')))
      ),
      
      spell.cast('Primordial Wave', this.getCurrentTarget, req =>
        this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Doom Winds', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Primordial Storm', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        (me.hasAura(auras.legacyfrostwitch) || !this.hasTalent(auras.legacyfrostwitch)) &&
        (spell.getCooldown('Doom Winds').timeleft >= 15000 || me.hasAura('Doom Winds'))
      ),
      
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura('Ascendance') &&
        this.surgingTotemActive() > 0 &&
        this.hasTalent('Earthsurge') &&
        me.hasAura(auras.legacyfrostwitch) &&
        me.getAuraStacks('Totemic Rebound') >= 5 &&
        me.getAuraStacks('Earthen Weapon') >= 2
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget, req =>
        this.hasTalent('Thorims Invocation') &&
        me.getAuraStacks(auras.maelstromweapon) > 0 &&
        this.canTiLightningBolt()
      ),
      
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura(auras.legacyfrostwitch) &&
        ((spell.getCooldown('Ascendance').timeleft >= 10000 && this.hasTalent('Ascendance')) || !this.hasTalent('Ascendance')) &&
        this.surgingTotemActive() > 0 &&
        me.getAuraStacks('Totemic Rebound') >= 3 &&
        !me.hasAura('Ascendance')
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        this.hasTalent('Unrelenting Storms') &&
        this.hasTalent('Alpha Wolf') &&
        this.alphaWolfMinRemains() === 0
      ),
      
      spell.cast('Lava Burst', this.getCurrentTarget, req =>
        !this.hasTalent('Thorims Invocation') &&
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        !me.hasAura('Whirling Air')
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        ((!this.hasTalent('Overflowing Maelstrom') && me.getAuraStacks(auras.maelstromweapon) >= 5) ||
         (me.getAuraStacks(auras.maelstromweapon) >= 9)) && 
        this.getChargesFractional('Elemental Blast') >= 1.8
      ),
      
           // spell.cast('Elemental Blast', this.getCurrentTarget, req => 
      //   ((!this.hasTalent('Overflowing Maelstrom') && me.getAuraStacks(auras.maelstromweapon) >= 5) ||
      //    (me.getAuraStacks(auras.maelstromweapon) >= 9)) && 
      //   this.getChargesFractional('Elemental Blast') >= 1.8
      // ),

      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        (!me.hasAura('Primordial Storm') || this.getAuraRemainingTime('Primordial Storm') > 4000)
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') && me.hasAura(auras.legacyfrostwitch)
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 10 &&
        (!me.hasAura('Primordial Storm') || this.getAuraRemainingTime('Primordial Storm') > 4000)
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req => 
        me.getAuraStacks('Electrostatic Wager') > 4
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') || me.getAuraStacks(auras.stormblast) > 1
      ),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        me.hasAura('Whirling Fire') || me.getAuraStacks('Ashen Catalyst') >= 8
      ),
      
      // Standard abilities
      spell.cast('Windstrike', this.getCurrentTarget),
      spell.cast('Stormstrike', this.getCurrentTarget),
      spell.cast('Lava Lash', this.getCurrentTarget),
      spell.cast('Crash Lightning', this.getCurrentTarget, req => Settings.ShamanEnhancer4Set),
      spell.cast('Voltaic Blaze', this.getCurrentTarget),
      spell.cast('Crash Lightning', this.getCurrentTarget, req => this.hasTalent('Unrelenting Storms')),
      spell.cast('Ice Strike', this.getCurrentTarget, req => !me.hasAura('Ice Strike')),
      spell.cast('Crash Lightning', this.getCurrentTarget),
      spell.cast('Frost Shock', this.getCurrentTarget),
      spell.cast('Fire Nova', this.getCurrentTarget, req => this.getCurrentTarget().hasAura('Flame Shock')),
      //spell.cast('Earth Elemental', this.getCurrentTarget),
      spell.cast('Flame Shock', this.getCurrentTarget, req => !this.hasTalent('Voltaic Blaze'))
    );
  }

// Standard abilities for AoE
  standardAoeAbilities() {
    return new bt.Selector(
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        this.hasTalent('Stormblast') && this.hasTalent('Stormflurry')
      ),
      
      spell.cast('Voltaic Blaze', this.getCurrentTarget),
      
      spell.cast('Lava Lash', this.getCurrentTarget, req =>
        this.hasTalent('Lashing Flames') || 
        (this.hasTalent('Molten Assault') && this.getCurrentTarget().hasAura('Flame Shock'))
      ),
      
      spell.cast('Ice Strike', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') && !me.hasAura('Ice Strike')
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') && me.hasAura('Hailstorm')
      ),
      
      spell.cast('Sundering', this.getCurrentTarget),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        this.hasTalent('Molten Assault') && !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        (this.hasTalent('Fire Nova') || this.hasTalent('Primordial Wave')) &&
        (this.activeDotCount('Flame Shock') < this.activeEnemiesCount()) &&
        this.activeDotCount('Flame Shock') < 6
      ),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') >= 3
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.hasAura('Crash Lightning') && 
        (this.hasTalent('Deeply Rooted Elements') || 
         me.getAuraStacks('Converging Storms') === me.getAuraMaxStacks('Converging Storms'))
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        this.hasTalent('Crashing Storms') && me.hasAura('CL Crash Lightning')
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget),
      spell.cast('Stormstrike', this.getCurrentTarget),
      spell.cast('Ice Strike', this.getCurrentTarget),
      spell.cast('Lava Lash', this.getCurrentTarget),
      spell.cast('Crash Lightning', this.getCurrentTarget),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') >= 2
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5 && !me.hasAura('Primordial Storm')
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        !this.hasTalent('Hailstorm')
      )
    );
  }

  // Standard abilities for single target
  standardSingleTargetAbilities() {
    return new bt.Selector(
      spell.cast('Crash Lightning', this.getCurrentTarget),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        me.hasAura('Hailstorm')
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget),
      
      spell.cast('Earth Elemental', this.getCurrentTarget)
    );
  }

  // Standard abilities (for use in funnel rotation)
  standardAbilities() {
    return new bt.Selector(
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') ||
        !me.hasAura('Crash Lightning') ||
        (this.hasTalent('Alpha Wolf') && this.feralSpiritActive() > 0 && this.alphaWolfMinRemains() === 0) ||
        (this.hasTalent('Converging Storms') && me.getAuraStacks('Converging Storms') < me.getAuraMaxStacks('Converging Storms'))
      ),
      
      spell.cast('Sundering', this.getCurrentTarget, req =>
        me.hasAura('Doom Winds') || this.hasTalent('Earthsurge')
      ),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') === 6 || 
        (this.activeDotCount('Flame Shock') >= 4 && this.activeDotCount('Flame Shock') === this.activeEnemiesCount())
      ),
      
      spell.cast('Ice Strike', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') && !me.hasAura('Ice Strike')
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        this.hasTalent('Hailstorm') && me.hasAura('Hailstorm')
      ),
      
      spell.cast('Sundering', this.getCurrentTarget),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        this.hasTalent('Molten Assault') && !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        (this.hasTalent('Fire Nova') || this.hasTalent('Primordial Wave')) &&
        (this.activeDotCount('Flame Shock') < this.activeEnemiesCount()) &&
        this.activeDotCount('Flame Shock') < 6
      ),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') >= 3
      ),
      
      spell.cast('Stormstrike', this.getCurrentTarget, req =>
        me.hasAura('Crash Lightning') && this.hasTalent('Deeply Rooted Elements')
      ),
      
      spell.cast('Crash Lightning', this.getCurrentTarget, req =>
        this.hasTalent('Crashing Storms') && me.hasAura('CL Crash Lightning') && this.getEnemiesInRange(8) >= 4
      ),
      
      spell.cast('Windstrike', this.getCurrentTarget),
      spell.cast('Stormstrike', this.getCurrentTarget),
      spell.cast('Ice Strike', this.getCurrentTarget),
      spell.cast('Lava Lash', this.getCurrentTarget),
      spell.cast('Crash Lightning', this.getCurrentTarget),
      
      spell.cast('Fire Nova', this.getCurrentTarget, req =>
        this.activeDotCount('Flame Shock') >= 2
      ),
      
      spell.cast('Elemental Blast', this.getCurrentTarget, req =>
        (!this.hasTalent('Elemental Spirits') || 
         (this.hasTalent('Elemental Spirits') && 
          (spell.getCharges('Elemental Blast') === spell.getMaxCharges('Elemental Blast') || me.hasAura(auras.feralspirits)))) &&
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Lava Burst', this.getCurrentTarget, req =>
        (me.getAuraStacks('Molten Weapon') > me.getAuraStacks('Crackling Surge')) &&
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Lightning Bolt', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5 &&
        (this.expectedLbFunnel() > this.expectedClFunnel())
      ),
      
      spell.cast('Chain Lightning', this.getCurrentTarget, req =>
        me.getAuraStacks(auras.maelstromweapon) >= 5
      ),
      
      spell.cast('Flame Shock', this.getCurrentTarget, req =>
        !this.getCurrentTarget().hasAura('Flame Shock')
      ),
      
      spell.cast('Frost Shock', this.getCurrentTarget, req =>
        !this.hasTalent('Hailstorm')
      )
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", this.getCurrentTarget, req => me.hasAura('Blood Fury') && (
        me.hasAura('Ascendance') || 
        me.hasAura(auras.feralspirits) || 
        me.hasAura('Doom Winds') || 
        this.minTalentedCdRemains() >= spell.getCooldown('Blood Fury').timeleft ||
        (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds'))
      )),
      
      spell.cast("Berserking", this.getCurrentTarget, req => me.hasAura('Berserking') && (
        me.hasAura('Ascendance') || 
        me.hasAura(auras.feralspirits) || 
        me.hasAura('Doom Winds') || 
        this.minTalentedCdRemains() >= spell.getCooldown('Berserking').timeleft ||
        (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds'))
      )),
      spell.cast("Berserking", this.getCurrentTarget),
      spell.cast("Fireblood", this.getCurrentTarget, req => me.hasAura('Fireblood') && (
        me.hasAura('Ascendance') || 
        me.hasAura(auras.feralspirits) || 
        me.hasAura('Doom Winds') || 
        this.minTalentedCdRemains() >= spell.getCooldown('Fireblood').timeleft ||
        (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds'))
      )),
      
      spell.cast("Ancestral Call", this.getCurrentTarget, req => me.hasAura('Ancestral Call') && (
        me.hasAura('Ascendance') || 
        me.hasAura(auras.feralspirits) || 
        me.hasAura('Doom Winds') || 
        this.minTalentedCdRemains() >= spell.getSpell('Ancestral Call').duration ||
        (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds'))
       )
      ));
  }

  // Helper methods for APL conditions
  hasTalent(talentName) {
    return me.hasAura(talentName);
  }
  
  useTrinkets() {
    return new bt.Selector(
      common.useEquippedItemByName("Signet of the Priory"),
      // Generic trinket use based on APL logic
      // common.useEquippedTrinket(1, req => 
      //   !this.isTrinketWeird(1) && 
      //   this.hasTrinketUseBuff(1) && 
      //   (me.hasAura('Ascendance') || 
      //    me.hasAura('Feral Spirit') || 
      //    me.hasAura('Doom Winds') || 
      //    this.minTalentedCdRemains() >= this.getTrinketCooldown(1) ||
      //    (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds')))
      // ),
      
      // common.useEquippedTrinket(2, req => 
      //   !this.isTrinketWeird(2) && 
      //   this.hasTrinketUseBuff(2) && 
      //   (me.hasAura('Ascendance') || 
      //    me.hasAura('Feral Spirit') || 
      //    me.hasAura('Doom Winds') || 
      //    this.minTalentedCdRemains() >= this.getTrinketCooldown(2) ||
      //    (!this.hasTalent('Ascendance') && !this.hasTalent('Feral Spirit') && !this.hasTalent('Doom Winds')))
      // ),
      
      // Specific named trinkets from APL
      // common.useEquippedItemByName("Elementium Pocket Anvil"),
      
      // common.useEquippedItemByName("Algethar Puzzle Box", req => 
      //   (!me.hasAura('Ascendance') && 
      //    !me.hasAura('Feral Spirit') && 
      //    !me.hasAura('Doom Winds')) || 
      //   (this.hasTalent('Ascendance') && 
      //    spell.getCooldown('Ascendance').timeleft < 2000 * spell.getGCD('Stormstrike'))
      // ),
      
      // common.useEquippedItemByName("Beacon to the Beyond", req => 
      //   (!me.hasAura('Ascendance') && 
      //    !me.hasAura('Feral Spirit') && 
      //    !me.hasAura('Doom Winds'))
      // ),
      
      // common.useEquippedItemByName("Manic Grieftorch", req => 
      //   (!me.hasAura('Ascendance') && 
      //    !me.hasAura('Feral Spirit') && 
      //    !me.hasAura('Doom Winds'))
      // ),
      
      // // Non-use buff trinkets
      // common.useEquippedTrinket(1, req => !this.isTrinketWeird(1) && !this.hasTrinketUseBuff(1)),
      // common.useEquippedTrinket(2, req => !this.isTrinketWeird(2) && !this.hasTrinketUseBuff(2))
    );
  }
  
  // Helper for checking if trinket is in the "weird" list per APL
  isTrinketWeird(slotNum) {
    const trinketName = this.getTrinketName(slotNum).toLowerCase();
    return (
      trinketName.includes("algethar puzzle box") ||
      trinketName.includes("manic grieftorch") ||
      trinketName.includes("elementium pocket anvil") ||
      trinketName.includes("beacon to the beyond")
    );
  }
  
  // Helper to check if trinket has a use buff effect
  hasTrinketUseBuff(slotNum) {
    // This is a simplified implementation since we can't directly check trinket data
    // In a real implementation, this would check if the trinket has a buff effect when used
    return true; 
  }
  
  // Helper to get trinket cooldown duration
  getTrinketCooldown(slotNum) {
    // Simplified implementation
    return slotNum === 1 ? 
      spell.getCooldown(this.getTrinketName(1)).duration : 
      spell.getCooldown(this.getTrinketName(2)).duration;
  }
  
  // Helper to get trinket name
  getTrinketName(slotNum) {
    // Simplified implementation - in a real version would access trinket name
    return slotNum === 1 ? "Trinket1" : "Trinket2";
  }
  
  // Helper to calculate minimum remaining cooldown of talented abilities
  minTalentedCdRemains() {
    let minRemains = 999999; // Large number as default
    
    if (this.hasTalent('Feral Spirit')) {
      const feralRemains = spell.getCooldown('Feral Spirit').timeleft % (4000 * (this.hasTalent('Witch Doctors Ancestry') ? 1 : 0));
      minRemains = Math.min(minRemains, feralRemains);
    }
    
    if (this.hasTalent('Doom Winds')) {
      minRemains = Math.min(minRemains, spell.getCooldown('Doom Winds').timeleft);
    }
    
    if (this.hasTalent('Ascendance')) {
      minRemains = Math.min(minRemains, spell.getCooldown('Ascendance').timeleft);
    }
    
    return minRemains;
  }
  
  
  
  // Helper functions for Thor's Invocation logic
  canTiLightningBolt() {
    return this.hasTalent('Thorims Invocation') &&
           me.getAuraStacks(auras.maelstromweapon) > 0 &&
           this.getEnemiesInRange(8) < 2; // Single target
  }
  
  canTiChainLightning() {
    return this.hasTalent('Thorims Invocation') &&
           me.getAuraStacks(auras.maelstromweapon) > 0 &&
           this.getEnemiesInRange(8) >= 2; // AoE
  }
  
  // Helper function to get current target
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  // Counts active enemies within a specific range around the current target
  activeEnemiesCount(range = 8) {
    return combat.targets.filter(unit => me.distanceTo2D(unit) <= range && unit.inCombatWithMe).length;
  }

  // Counts how many targets currently have the specified DoT
  activeDotCount(auraName, range = 40) {
    return combat.targets.filter(unit => 
      unit.hasAura(auraName) && me.distanceTo2D(unit) <= range && unit.inCombatWithMe
    ).length;
  }

  // Returns the number of enemies in range of the player
  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }
  
  // Counts enemies around the target
  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }

  // Gets the count of active Feral Spirits
  feralSpiritActive() {
    
        // Sucht alle Einheiten, die vom Spieler beschworen wurden
        let count = 0;
        
        // Durchsuche alle Objekte im ObjectManager
        objMgr.objects.forEach(obj => {
            // Prüfe, ob das Objekt eine Einheit ist
            if (obj instanceof wow.CGUnit) {
                // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Feral Spirit ist
                if (obj.createdBy && 
                    me.guid && 
                    obj.createdBy.equals(me.guid) && 
                    obj.name === 'Feral Spirit') {
                    count++;
                }
            }
        });
        return count;
  }

  // Checks if Surging Totem is active and returns remaining time
  surgingTotemActive() {
    let count = 0;  
    // Durchsuche alle Objekte im ObjectManager
    objMgr.objects.forEach(obj => {
        // Prüfe, ob das Objekt eine Einheit ist
        if (obj instanceof wow.CGUnit) {
            // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Feral Spirit ist
            if (obj.createdBy && 
                me.guid && 
                obj.createdBy.equals(me.guid) && 
                obj.name === 'Surging Totem') {
                count++;
            }
        }
    });

    return count;
  }

  // Checks if Searing Totem is active
  searingTotemActive() {
    
      
    let count = 0;  
    // Durchsuche alle Objekte im ObjectManager
    objMgr.objects.forEach(obj => {
        // Prüfe, ob das Objekt eine Einheit ist
        if (obj instanceof wow.CGUnit) {
            // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Feral Spirit ist
            if (obj.createdBy && 
                me.guid && 
                obj.createdBy.equals(me.guid) && 
                obj.name === 'Surging Totem') {
                count++;
            }
        }
    });

    return count > 0 ? true : false;
  }

  // Returns the minimum remaining time of Alpha Wolf aura on all Feral Spirits
  alphaWolfMinRemains() {
    const alphaWolves = wow.Pet.activePets.filter(pet => pet.name === 'Alpha Wolf');
    if (alphaWolves.length === 0) return 0;
    return Math.min(...alphaWolves.map(wolf => wolf.auraRemainingTime));
  }

  // Returns the expected Lightning Bolt funnel damage (for Funnel APL logic)
  expectedLbFunnel() {
    // Simplified implementation based on APL variables
    const natureMod = (1 + (this.getCurrentTarget().hasAura('Chaos Brand') ? 0.05 : 0)) * 
                      (1 + (this.getCurrentTarget().hasAura('Hunters Mark') && 
                            this.getCurrentTarget().pctHealth >= 80 ? 0.05 : 0));
    
    // Base LB damage (simplified)
    const lbDamage = 100; 
    
    return lbDamage * (1 + (this.getCurrentTarget().hasAura('Lightning Rod') ? 
           natureMod * (1 + (me.hasAura('Primordial Wave') ? 
                            this.activeDotCount('Flame Shock') * 0.2 : 0)) * 0.2 : 0));
  }

  // Returns the expected Chain Lightning funnel damage (for Funnel APL logic)
  expectedClFunnel() {
    // Simplified implementation based on APL variables
    const natureMod = (1 + (this.getCurrentTarget().hasAura('Chaos Brand') ? 0.05 : 0)) * 
                      (1 + (this.getCurrentTarget().hasAura('Hunters Mark') && 
                            this.getCurrentTarget().pctHealth >= 80 ? 0.05 : 0));
    
    // Base CL damage (simplified)
    const clDamage = 80;
    
    // Max targets for CL based on talents
    const maxTargets = Math.max(this.getEnemiesInRange(8), (3 + 2 * (this.hasTalent('Crashing Storms') ? 1 : 0)));
    
    return clDamage * (1 + (this.getCurrentTarget().hasAura('Lightning Rod') ? 
           natureMod * maxTargets * 0.2 : 0));
  }

  // Gets the remaining time of an aura on the player
  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  startCombatTimer() {
    console.debug("----- START TIMER -----");
    if (currentCombatTime != 0)
      return
    
    combatStartTime = Date.now();
    currentCombatTime = 0;
    
    // Clear any existing timer to prevent duplicates
    if (combatTimer) {
      clearInterval(combatTimer);
    }
    
    // Start a new timer that updates currentCombatTime every 10ms
    this.combatTimer = setInterval(() => {
      currentCombatTime = Date.now() - combatStartTime;
    }, 10);
  }
  
  // Function to stop combat timer
  stopCombatTimer() {
    console.debug("----- STOP TIMER -----");
    if (combatTimer) {
      clearInterval(combatTimer);
     combatTimer = null;
    }
    combatStartTime = 0;
    currentCombatTime = 0;
  }

  getChargesFractional(spellName) {
    const spell = spell.getSpell(spellName);
    if (!spell || !spell.charges) return 0;
    
    const currentCharges = spell.charges.charges || 0;
    const maxCharges = spell.charges.maxCharges || 0;
    
    if (currentCharges >= maxCharges) return currentCharges;
    
    const remainingTime = spell.charges.start + spell.charges.duration - wow.frameTime;
    const chargeDuration = spell.charges.duration;
    const fractionalPart = 1 - (remainingTime / chargeDuration);
    
    return currentCharges + fractionalPart;
  }

  trackTotems() {
    const activeTotems = [];
    
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit && 
          obj.createdBy && 
          me.guid && 
          obj.createdBy.equals(me.guid)) {
        
        // Check if it's any type of totem
        if (obj.name.includes('Totem')) {
          // Get health percentage to determine totem lifetime
          const healthPct = obj.pctHealth;
          const distanceToPlayer = me.distanceTo(obj);
          
          activeTotems.push({
            guid: obj.guid,
            name: obj.name,
            position: obj.position,
            distance: distanceToPlayer,
            health: healthPct
          });
        }
      }
    });
    
    return activeTotems;
  }
  
  // Find specifically the Surging Totem and get detailed information
  getSurgingTotemInfo() {
    let totemInfo = null;
    
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit && 
          obj.createdBy && 
          me.guid && 
          obj.createdBy.equals(me.guid) && 
          obj.name === 'Surging Totem') {
        
        const distanceToPlayer = me.distanceTo(obj);
        
        totemInfo = {
          guid: obj.guid,
          position: obj.position,
          distance: distanceToPlayer,
          health: obj.pctHealth,
          entryId: obj.entryId,
          // Calculate remaining time (approximation based on health)
          remainingTime: (obj.pctHealth / 100) * 120000 // Assuming 120sec max duration
        };
      }
    });
    
    return totemInfo;
  }
  
  // Manage totem relocation
  manageSurgingTotem() {
    return new bt.Selector(
      new bt.Action(() => {
        // Don't attempt relocation if player is moving
        if (me.isMoving()) {
          return bt.Status.Failure;
        }
  
        const totemInfo = this.getSurgingTotemInfo();
        
        // If totem is active and far away
        if (totemInfo && totemInfo.distance > 15) {
          
          // Check if we should relocate based on remaining time
          const shouldRelocate = totemInfo.remainingTime > 30000; // Only relocate if >30 seconds left
          
          if (shouldRelocate) {
            console.info(`Relocating Surging Totem - ${totemInfo.distance.toFixed(1)} yards away, ${(totemInfo.remainingTime/1000).toFixed(1)}s remaining`);
            
            // Try to cast the totem again if available
            const surgingTotem = spell.getSpell('Surging Totem');
            const totemicRecall = spell.getSpell('Totemic Recall');
            
            // First recall existing totems if that ability exists
            if (totemicRecall && totemicRecall.isKnown && totemicRecall.cooldown.ready) {
              totemicRecall.cast();
              return bt.Status.Success;
            }
            
            // If there's no recall ability, try to place a new totem
            if (surgingTotem && surgingTotem.isKnown && surgingTotem.cooldown.ready) {
              surgingTotem.cast();
              return bt.Status.Success;
            }
          }
        }
        
        return bt.Status.Failure;
      })
    );
  }
  
  // Get the count of active totems by name
  getTotemCount(totemName) {
    let count = 0;
    
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit && 
          obj.createdBy && 
          me.guid && 
          obj.createdBy.equals(me.guid) && 
          obj.name === totemName) {
        count++;
      }
    });
    
    return count;
  }
  
}
