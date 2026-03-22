import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType as DispelType } from "@/Enums/Auras";
import { PowerType } from '@/Enums/PowerType';
import KeyBinding from "@/Core/KeyBinding";

export class EjtMageArcaneBehavior extends Behavior {
  name = "[ejt] Mage Arcane";
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Arcane;

  static settings = [
    {
      header: "Burst Toggle System",
      options: [
        { type: "checkbox", uid: "UseBurstToggle", text: "Use Burst Toggle", default: true },
        { type: "hotkey", uid: "BurstToggleKeybind", text: "Burst Toggle Key", default: imgui.Key.X },
        { type: "checkbox", uid: "BurstModeWindow", text: "Use Window Mode (unchecked = Toggle Mode)", default: false },
        { type: "slider", uid: "BurstWindowDuration", text: "Burst Window Duration (seconds)", min: 5, max: 60, default: 15 }
      ]
    },
  ];

  constructor() {
    super();

    // Initialize the burst toggle keybinding with default
    KeyBinding.setDefault("BurstToggleKeybind", imgui.Key.F1);

    /** @type {wow.CGUnit} */
    this.currentTarget = null;
    this.gcdMax = 1500;
    this.soulBurst = false;
    this.soulcd = false;
    this.aoeTargetCount = 0;
    this.activeEnemies = 0;
    this.opener = false;
    this.aoeList = false;
    this.interruptCondition = null;
    this.showOverlay = new imgui.MutableVariable(false);
    this.useSoulBurst = new imgui.MutableVariable(false);
    this.burstModeActive = false;
    this.burstToggleTime = 0;
  }

  build() {
    return new bt.Selector("Arcane Mage",
      this.renderOverlay(),
      new bt.Action(_ => {
        // Handle burst toggle system
        this.handleBurstToggle();

        // Legacy: Burst mode toggle with X key (if not using burst toggle system)
        if (!Settings.UseBurstToggle && imgui.isKeyPressed(imgui.Key.X)) {
          this.burstModeActive = !this.burstModeActive;
          console.log(`Burst mode ${this.burstModeActive ? 'ACTIVATED' : 'DEACTIVATED'}`);
        }
      }),
      this.preCombat(),
      common.waitForNotMounted(),
      new bt.Action(() => {
        this.currentTarget = this.getCurrentTarget();
        this.activeEnemies = 0;
        if (this.currentTarget === null) {
          return bt.Status.Success;
        }
        this.activeEnemies = this.enemiesAroundTarget(10) + 1;
        return bt.Status.Failure;
      }, "Get current target"),
      new bt.Decorator(
        req => me.currentChannel === 5143 && this.interruptCondition?.(),
        new bt.Action(ret => {
          me.stopCasting();
          return bt.Status.Failure;
        }),
        "Interrupt Arcane Missiles"
      ),
      common.waitForCastOrChannel(),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.executeEachTick(),

          // actions.precombat+=/mirror_image
          /* TODO: just cast always for now */ spell.cast("Mirror Image"),
          // actions.precombat+=/arcane_blast,if=!talent.evocation
          // actions.precombat+=/evocation,if=talent.evocation&!variable.soul_cd
          // actions.precombat+=/arcane_surge,if=variable.soul_cd

          // # Enter cooldowns, then action list depending on your hero talent choices.
          // actions+=/call_action_list,name=cd_opener,if=!variable.soul_cd
          new bt.Decorator(
            req => !this.soulcd && this.shouldUseBurstAbilities(),
            this.cd_opener(),
            "Cooldown opener no soul"
          ),
          // actions+=/call_action_list,name=cd_opener_soul,if=variable.soul_cd
          new bt.Decorator(
            req => this.soulcd && this.shouldUseBurstAbilities(),
            this.cd_opener_soul(),
            "Cooldown opener soul"
          ),

          // actions+=/call_action_list,name=sunfury,if=talent.spellfire_spheres
          new bt.Decorator(
            req => me.hasVisibleAura("Spellfire Spheres"),
            this.sunfury(),
            "Rotation Sunfury"
          ),

          // actions+=/call_action_list,name=spellslinger,if=!talent.spellfire_spheres
          new bt.Decorator(
            req => !me.hasVisibleAura("Spellfire Spheres"),
            this.spellslinger(),
            "Rotation Spellslinger"
          ),

          // actions+=/arcane_barrage
          spell.cast("Arcane Barrage", on => this.currentTarget),
        )
      )
    );
  }

  handleBurstToggle() {
    if (!Settings.UseBurstToggle) return;

    // Check for keybind press using the KeyBinding system
    if (KeyBinding.isPressed("BurstToggleKeybind")) {

      if (!Settings.BurstModeWindow) {
        // Toggle mode: flip the state
        combat.burstToggle = !combat.burstToggle;
        this.burstModeActive = combat.burstToggle;
        console.log(`Burst toggle ${combat.burstToggle ? 'ACTIVATED' : 'DEACTIVATED'} (Toggle mode)`);
      } else {
        // Window mode: start the burst window
        combat.burstToggle = true;
        this.burstModeActive = true;
        this.burstToggleTime = wow.frameTime;
        console.log(`Burst window ACTIVATED for ${Settings.BurstWindowDuration} seconds`);
      }
    }

    // Handle burst window timeout - always check if we're in window mode and burst is active
    if (Settings.BurstModeWindow && combat.burstToggle && this.burstToggleTime > 0) {
      const elapsed = (wow.frameTime - this.burstToggleTime) / 1000;

      if (elapsed >= Settings.BurstWindowDuration) {
        combat.burstToggle = false;
        this.burstModeActive = false;
        this.burstToggleTime = 0; // Reset the timer
        console.log(`Burst window EXPIRED after ${elapsed.toFixed(1)}s`);
      }
    }
  }

  shouldUseBurstAbilities() {
    if (Settings.UseBurstToggle) {
      return combat.burstToggle;
    }
    // Legacy burst mode for X key
    return this.burstModeActive;
  }

  renderOverlay() {
    return new bt.Action(ret => {
      // Safety check
      if (!me) return;

      if (!this.showOverlay.value) {
        return;
      }

      const viewport = imgui.getMainViewport();
      if (!viewport) {
        return;
      }

      const workPos = viewport.workPos;
      const workSize = viewport.workSize;

      // Position overlay in top-right corner
      const overlaySize = { x: 250, y: 220 };
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

      const red = { r: 1.0, g: 0.2, b: 0.2, a: 1.0 };
      const green = { r: 0.2, g: 1.0, b: 0.2, a: 1.0 };
      if (imgui.begin("Arcane Mage Overlay", this.showOverlay, windowFlags)) {
        if (imgui.collapsingHeader("Debug Variables", imgui.TreeNodeFlags.DefaultOpen)) {
          imgui.indent();

          imgui.checkbox("Use Soul Burst", this.useSoulBurst);
          imgui.pushStyleColor(imgui.Col.Text, this.soulBurst ? green : red);
          imgui.text(`Soul Burst: ${this.soulBurst}`);
          imgui.popStyleColor();
          imgui.pushStyleColor(imgui.Col.Text, this.soulcd ? green : red);
          imgui.text(`Soul Cooldown: ${this.soulcd}`);
          imgui.popStyleColor();
          imgui.pushStyleColor(imgui.Col.Text, this.aoeTargetCount > 0 ? green : red);
          imgui.text(`Aoe Target Count: ${this.aoeTargetCount}`);
          imgui.popStyleColor();
          imgui.pushStyleColor(imgui.Col.Text, this.activeEnemies > 0 ? green : red);
          imgui.text(`Active Enemies: ${this.activeEnemies}`);
          imgui.popStyleColor();
          imgui.pushStyleColor(imgui.Col.Text, this.opener ? green : red);
          imgui.text(`Opener: ${this.opener}`);
          imgui.popStyleColor();
          imgui.text(`Arcane Charges: ${this.arcaneCharges}`);
          if (this.currentTarget) {
            imgui.text(`Current Target TTD: ${this.currentTarget.timeToDeath()?.toFixed(2)}`);
          }
          const channeling = me.spellInfo.channelEnd > wow.frameTime;
          imgui.pushStyleColor(imgui.Col.Text, channeling ? green : red);
          imgui.text(`Channeling: ${channeling}`);
          imgui.popStyleColor();
          imgui.text(`Arcane Charges: ${this.arcaneCharges}`);
          imgui.unindent();
        }
      }
      imgui.end();

      return bt.Status.Failure;
    }, "Render Overlay");
  }

  preCombat() {
    return new bt.Decorator(
      ret => !me.inCombat(),
      new bt.Action(ret => {
        this.gcdMax = 1500 * me.modHaste;
        // # Executed before combat begins. Accepts non-harmful actions only.
        // actions.precombat=arcane_intellect

        // actions.precombat+=/variable,name=soul_burst,default=0,op=reset
        this.soulBurst = this.useSoulBurst.value; /* XXX: make this an option */
        // actions.precombat+=/variable,name=soul_cd,op=set,value=1,if=set_bonus.thewarwithin_season_3_4pc&talent.spellfire_spheres&talent.resonance&!talent.magis_spark&(active_enemies>=3)&variable.soul_burst
        this.soulcd = me.hasVisibleAura("Spellfire Spheres") && me.hasVisibleAura("Resonance") && !me.hasVisibleAura("Magi's Spark") && this.enemiesAroundTarget(10) >= 3 && this.soulBurst;
        // actions.precombat+=/variable,name=aoe_target_count,op=reset,default=2
        this.aoeTargetCount = 2;
        // actions.precombat+=/variable,name=aoe_target_count,op=set,value=9,if=!talent.arcing_cleave
        if (!me.hasVisibleAura("Arcing Cleave")) {
          this.aoeTargetCount = 9;
        }
        // actions.precombat+=/variable,name=opener,op=set,value=1
        if (!this.opener) {
          this.opener = true;
          console.info("Enable opener");
        }
        // actions.precombat+=/variable,name=aoe_list,default=0,op=reset
        this.aoeList = false;
        // actions.precombat+=/variable,name=steroid_trinket_equipped,op=set,value=equipped.gladiators_badge|equipped.signet_of_the_priory|equipped.imperfect_ascendancy_serum|equipped.quickwick_candlestick|equipped.soulletting_ruby|equipped.funhouse_lens|equipped.house_of_cards|equipped.flarendos_pilot_light|equipped.neural_synapse_enhancer|equipped.lily_of_the_eternal_weave|equipped.sunblood_amethyst|equipped.arazs_ritual_forge|equipped.incorporeal_essencegorger
        // actions.precombat+=/variable,name=nonsteroid_trinket_equipped,op=set,value=equipped.blastmaster3000|equipped.ratfang_toxin|equipped.ingenious_mana_battery|equipped.geargrinders_spare_keys|equipped.ringing_ritual_mud|equipped.goo_blin_grenade|equipped.noggenfogger_ultimate_deluxe|equipped.garbagemancers_last_resort|equipped.mad_queens_mandate|equipped.fearbreakers_echo|equipped.mereldars_toll|equipped.gooblin_grenade|equipped.perfidious_projector|equipped.chaotic_nethergate
        return bt.Status.Failure;
      }),
      "Pre combat");
  }

  executeEachTick() {
    return new bt.Selector(
      // # Executed every time the actor is available.
      // actions=counterspell
      spell.interrupt("Counterspell"),
      // # Tempered Potions last 30s so we generally will use them at the start of our cooldown windows.
      // actions+=/potion,if=(buff.siphon_storm.up|(!talent.evocation&cooldown.arcane_surge.ready)|((cooldown.arcane_surge.ready|buff.arcane_surge.up)&variable.soul_cd))|fight_remains<30
      // # Lights Judgment is the only racial ability worth using and is only worthwhile to use outside of cooldowns.
      // actions+=/lights_judgment,if=(buff.arcane_surge.down&debuff.touch_of_the_magi.down&buff.arcane_soul.down&buff.siphon_storm.down&active_enemies>=2)
      // # Racials are used after Surge.
      new bt.Decorator(
        req => (me.hasAuraByMe("Siphon Storm") && this.soulcd) || (/*spell.getLastSuccessfulSpell()?.spellName == "Arcane Surge" && */!this.soulcd),
        // actions+=/berserking,if=(buff.siphon_storm.up&variable.soul_cd)|(prev_gcd.1.arcane_surge&!variable.soul_cd)
        spell.cast("Berserking"),
        // actions+=/blood_fury,if=(buff.siphon_storm.up&variable.soul_cd)|(prev_gcd.1.arcane_surge&!variable.soul_cd)
        spell.cast("Blood Fury"),
        // actions+=/fireblood,if=(buff.siphon_storm.up&variable.soul_cd)|(prev_gcd.1.arcane_surge&!variable.soul_cd)
        spell.cast("Fireblood"),
        // actions+=/ancestral_call,if=(buff.siphon_storm.up&variable.soul_cd)|(prev_gcd.1.arcane_surge&!variable.soul_cd)
        spell.cast("Ancestral Call"),
      ),
      // # Invoke Externals with cooldowns except Autumn which should come just after cooldowns
      // actions+=/invoke_external_buff,name=power_infusion,if=prev_gcd.1.arcane_surge
      // actions+=/invoke_external_buff,name=blessing_of_autumn,if=cooldown.touch_of_the_magi.remains>5
      // # Trinket specific use cases vary, default is just after Surge.
      // actions+=/use_items,if=(((!variable.soul_cd&prev_gcd.1.arcane_surge)|(variable.soul_cd&buff.siphon_storm.up&debuff.touch_of_the_magi.up))&(variable.steroid_trinket_equipped|(!variable.steroid_trinket_equipped&!variable.nonsteroid_trinket_equipped)))|(!variable.steroid_trinket_equipped&variable.nonsteroid_trinket_equipped)|(variable.nonsteroid_trinket_equipped&buff.siphon_storm.remains<10&(cooldown.evocation.remains>17|trinket.cooldown.remains>20))|fight_remains<20
      new bt.Decorator(
        req => ((!this.soulcd) || (this.soulcd && me.hasAuraByMe("Siphon Storm") && this.currentTarget.hasAuraByMe("Touch of the Magi"))) || this.currentTarget.timeToDeath() < 20,
        new bt.Selector(
          common.useEquippedItemByName("Lily of the Eternal Weave"),
        ),
      ),
      // actions+=/variable,name=opener,op=set,if=debuff.touch_of_the_magi.up&variable.opener,value=0
      new bt.Action(ret => {
        if (this.opener && this.currentTarget.hasAuraByMe("Touch of the Magi")) {
          this.opener = false;
        }
        return bt.Status.Failure;
      }),
      // actions+=/arcane_barrage,if=fight_remains<2
      spell.cast("Arcane Barrage", req => this.currentTarget.timeToDeath() < 2),
    );
  }

  cd_opener() {
    return new bt.Selector(
      // # Touch of the Magi used if you just used Arcane Surge, the wait simulates the time it takes to queue another spell after Touch when you Surge into Touch, otherwise we'll Touch off cooldown either after Barrage or if we just need Charges.
      // actions.cd_opener=touch_of_the_magi,use_off_gcd=1,if=prev_gcd.1.arcane_surge|(cooldown.arcane_surge.remains>30&cooldown.touch_of_the_magi.ready&((buff.arcane_charge.stack<4&!prev_gcd.1.arcane_barrage)|prev_gcd.1.arcane_barrage))|fight_remains<15
      spell.cast("Touch of the Magi", on => this.currentTarget, req => /*spell.getLastSuccessfulSpell()?.spellName === "Arcane Surge" || */(spell.getCooldown("Arcane Surge")?.timeleft > 40000 && ((this.arcaneCharges < 4/* || !spell.getLastSuccessfulSpell()?.spellName === "Arcane Barrage"*/)/* || spell.getLastSuccessfulSpell()?.spellName == "Arcane Barrage"*/)) || this.currentTarget.timeToDeath() > 15),
      // actions.cd_opener+=/wait,sec=0.05,if=prev_gcd.1.arcane_surge&time-action.touch_of_the_magi.last_used<0.015,line_cd=15
      // actions.cd_opener+=/arcane_blast,if=buff.presence_of_mind.up
      spell.cast("Arcane Blast", on => this.currentTarget, req => me.hasAuraByMe("Presence of Mind")),
      // # Use Orb for Charges on the opener if you have High Voltage as the Missiles will generate the remaining Charge you need
      // actions.cd_opener+=/arcane_orb,if=talent.high_voltage&variable.opener,line_cd=10
      spell.cast("Arcane Orb", on => this.currentTarget, req => this.facingForOrb() && me.hasVisibleAura("High Voltage") && this.opener),
      // # Barrage before Evocation if Tempo will expire
      // actions.cd_opener+=/arcane_barrage,if=buff.arcane_tempo.up&cooldown.evocation.ready&buff.arcane_tempo.remains<gcd.max*5,line_cd=11
      spell.cast("Arcane Barrage", on => this.currentTarget, req => me.hasAuraByMe("Arcane Tempo") && spell.getCooldown("Evocation")?.ready === true && me.getVisibleAura("Arcane Tempo")?.remaining < this.gcdMax * 5),
      // actions.cd_opener+=/evocation,if=cooldown.arcane_surge.remains<(gcd.max*3)&cooldown.touch_of_the_magi.remains<(gcd.max*5)|fight_remains<25
      spell.cast("Evocation", on => me, req => spell.getCooldown("Arcane Surge")?.timeleft < (this.gcdMax * 3) && spell.getCooldown("Touch of the Magi")?.timeleft < (this.gcdMax * 5) || this.currentTarget.timeToDeath() > 25),
      // # Use Missiles to get Nether Precision up for your burst window, clipping logic applies as long as you don't have Aether Attunement.
      // actions.cd_opener+=/arcane_missiles,if=(prev_gcd.1.evocation|prev_gcd.1.arcane_surge|variable.opener)&buff.nether_precision.down,interrupt_if=tick_time>gcd.remains&buff.aether_attunement.react=0,interrupt_immediate=1,interrupt_global=1,chain=1,line_cd=30
      this.castArcaneMissiles(req => (/*spell.getLastSuccessfulSpell()?.spellName == "Evocation" || spell.getLastSuccessfulSpell()?.spellName == "Arcane Surge" || */this.opener) && !me.hasAuraByMe("Nether Precision"), interrupt => !spell.isGlobalCooldown() && !me.hasAuraByMe("Aether Attunement")),
      // actions.cd_opener+=/arcane_surge,if=cooldown.touch_of_the_magi.remains<(action.arcane_surge.execute_time+(gcd.max*(buff.arcane_charge.stack=4)))|fight_remains<25
      spell.cast("Arcane Surge", on => this.currentTarget, req => spell.getCooldown("Touch of the Magi")?.timeleft < (1900 + (this.gcdMax * (this.arcaneCharges === 4 ? 1 : 0))) || this.currentTarget.timeToDeath() > 25),
    );
  }

  cd_opener_soul() {
    return new bt.Selector("Cooldown opener soul",
      // # Alternate tier set opener for AOE. Surge, then Evocate 5-7s later, then Touch when Surge has a few seconds remaining.
      // actions.cd_opener_soul=arcane_surge,if=(cooldown.touch_of_the_magi.remains<15)
      spell.cast("Arcane Surge", on => this.currentTarget, req => spell.getCooldown("Touch of the Magi") < 15000),
      // actions.cd_opener_soul+=/evocation,if=buff.arcane_surge.up&(buff.arcane_surge.remains<=8.5|((buff.glorious_incandescence.up|buff.intuition.react)&buff.arcane_surge.remains<=10))
      spell.cast("Evocation", on => me, req => me.hasAuraByMe("Arcane Surge") && (me.getVisibleAura("Arcane Surge")?.remaining < 8500 || ((me.hasAuraByMe("Glorious Incandescence") || me.hasAuraByMe("Intuition")) && me.getVisibleAura("Arcane Surge")?.remaining < 10000))),
      // actions.cd_opener_soul+=/touch_of_the_magi,if=(buff.arcane_surge.remains<=2.5&prev_gcd.1.arcane_barrage)|(cooldown.evocation.remains>40&cooldown.evocation.remains<60&prev_gcd.1.arcane_barrage)
      spell.cast("Touch of the Magi", on => this.currentTarget, req => (me.getVisibleAura("Arcane Surge")?.remaining < 2500 /* && prev_gcd.1.arcane_barrage */) || (spell.getCooldown("Evocation")?.timeleft > 40000 && spell.getCooldown("Evocation")?.timeleft < 60000 /* && prev_gcd.1.arcane_barrage*/)),
    );
  }

  spellslinger() {
    // # With Shifting Shards we can use Shifting Power whenever basically favoring cooldowns slightly, without it though we want to use it outside of cooldowns, don't cast if it'll conflict with Intuition expiration.
    // actions.spellslinger=shifting_power,if=(((((action.arcane_orb.charges=0)&cooldown.arcane_orb.remains>16)|cooldown.touch_of_the_magi.remains<20)&buff.arcane_surge.down&buff.siphon_storm.down&debuff.touch_of_the_magi.down&(buff.intuition.react=0|(buff.intuition.react&buff.intuition.remains>cast_time))&cooldown.touch_of_the_magi.remains>(12+6*gcd.max))|(prev_gcd.1.arcane_barrage&talent.shifting_shards&(buff.intuition.react=0|(buff.intuition.react&buff.intuition.remains>cast_time))&(buff.arcane_surge.up|debuff.touch_of_the_magi.up|cooldown.evocation.remains<20)))&fight_remains>10&(buff.arcane_tempo.remains>gcd.max*2.5|buff.arcane_tempo.down)
    // # In single target, use Presence of Mind at the very end of Touch of the Magi, then cancelaura the buff to start the cooldown, wait is to simulate the delay of hitting Presence of Mind after another spell cast.
    // actions.spellslinger+=/cancel_buff,name=presence_of_mind,use_off_gcd=1,if=prev_gcd.1.arcane_blast&buff.presence_of_mind.stack=1
    // actions.spellslinger+=/presence_of_mind,if=debuff.touch_of_the_magi.remains<=gcd.max&buff.nether_precision.up&active_enemies<variable.aoe_target_count&!talent.unerring_proficiency
    // actions.spellslinger+=/wait,sec=0.05,if=time-action.presence_of_mind.last_used<0.015,line_cd=15
    // actions.spellslinger+=/supernova,if=debuff.touch_of_the_magi.remains<=gcd.max&buff.unerring_proficiency.stack=30
    // # Orb if you need charges.
    // actions.spellslinger+=/arcane_orb,if=buff.arcane_charge.stack<4
    // # Barrage if Tempo is about to expire.
    // actions.spellslinger+=/arcane_barrage,if=(buff.arcane_tempo.up&buff.arcane_tempo.remains<gcd.max)
    // # Use Aether Attunement up before casting Touch if you have S2 4pc equipped to avoid munching.
    // actions.spellslinger+=/arcane_missiles,if=buff.aether_attunement.react&cooldown.touch_of_the_magi.remains<gcd.max*3&buff.clearcasting.react&set_bonus.thewarwithin_season_2_4pc
    // # Barrage if Touch is up or will be up while Barrage is in the air.
    // actions.spellslinger+=/arcane_barrage,if=(cooldown.touch_of_the_magi.ready|cooldown.touch_of_the_magi.remains<((travel_time+0.05)>?gcd.max))&(cooldown.arcane_surge.remains>30&cooldown.arcane_surge.remains<75)
    // # Anticipate the Intuition granted from the Season 3 set bonus.
    // actions.spellslinger+=/arcane_barrage,if=buff.arcane_charge.stack=4&buff.arcane_harmony.stack>=20&set_bonus.thewarwithin_season_3_4pc
    // # Use Clearcasting procs to keep Nether Precision up, if you don't have S2 4pc try to pool Aether Attunement for cooldown windows.
    // actions.spellslinger+=/arcane_missiles,if=(buff.clearcasting.react&buff.nether_precision.down&((cooldown.touch_of_the_magi.remains>gcd.max*7&cooldown.arcane_surge.remains>gcd.max*7)|buff.clearcasting.react>1|!talent.magis_spark|(cooldown.touch_of_the_magi.remains<gcd.max*4&buff.aether_attunement.react=0)|set_bonus.thewarwithin_season_2_4pc))|(fight_remains<5&buff.clearcasting.react),interrupt_if=tick_time>gcd.remains&(buff.aether_attunement.react=0|(active_enemies>3&(!talent.time_loop|talent.resonance))),interrupt_immediate=1,interrupt_global=1,chain=1
    // # Missile to refill charges if you have High Voltage and either Aether Attunement or more than one Clearcasting proc. Recheck AOE
    // actions.spellslinger+=/arcane_missiles,if=talent.high_voltage&(buff.clearcasting.react>1|(buff.clearcasting.react&buff.aether_attunement.react))&buff.arcane_charge.stack<3,interrupt_if=tick_time>gcd.remains&(buff.aether_attunement.react=0|(active_enemies>3&(!talent.time_loop|talent.resonance))),interrupt_immediate=1,interrupt_global=1,chain=1
    // # Use Intuition.
    // actions.spellslinger+=/arcane_barrage,if=buff.intuition.react
    // # Make sure to always activate Spark!
    // actions.spellslinger+=/arcane_blast,if=debuff.magis_spark_arcane_blast.up|buff.leydrinker.up,line_cd=2
    // # In single target, spending your Nether Precision stacks on Blast is a higher priority in single target.
    // actions.spellslinger+=/arcane_blast,if=buff.nether_precision.up&buff.arcane_harmony.stack<=16&buff.arcane_charge.stack=4&active_enemies=1
    // # Barrage if you're going to run out of mana and have Orb ready.
    // actions.spellslinger+=/arcane_barrage,if=mana.pct<10&buff.arcane_surge.down&(cooldown.arcane_orb.remains<gcd.max)
    // # Orb in ST if you don't have Charged Orb, will overcap soon, and before entering cooldowns.
    // actions.spellslinger+=/arcane_orb,if=active_enemies=1&(cooldown.touch_of_the_magi.remains<6|!talent.charged_orb|buff.arcane_surge.up|cooldown.arcane_orb.charges_fractional>1.5)
    // # Barrage if you have orb coming off cooldown in AOE and you don't have enough harmony stacks to make it worthwhile to hold for set proc.
    // actions.spellslinger+=/arcane_barrage,if=active_enemies>=2&buff.arcane_charge.stack=4&cooldown.arcane_orb.remains<gcd.max&(buff.arcane_harmony.stack<=(8+(10*!set_bonus.thewarwithin_season_3_4pc)))&(((prev_gcd.1.arcane_barrage|prev_gcd.1.arcane_orb)&buff.nether_precision.stack=1)|buff.nether_precision.stack=2|buff.nether_precision.down)
    // actions.spellslinger+=/arcane_barrage,if=active_enemies>2&(buff.arcane_charge.stack=4&!set_bonus.thewarwithin_season_3_4pc)
    // # Orb if you're low on Harmony stacs.
    // actions.spellslinger+=/arcane_orb,if=active_enemies>1&buff.arcane_harmony.stack<20&(buff.arcane_surge.up|buff.nether_precision.up|active_enemies>=7)&set_bonus.thewarwithin_season_3_4pc
    // # Arcane Barrage in AOE if you have Aether Attunement ready and High Voltage
    // actions.spellslinger+=/arcane_barrage,if=talent.high_voltage&active_enemies>=2&buff.arcane_charge.stack=4&buff.aether_attunement.react&buff.clearcasting.react
    // # Use Orb more aggressively if cleave and a little less in AOE.
    // actions.spellslinger+=/arcane_orb,if=active_enemies>1&(active_enemies<3|buff.arcane_surge.up|(buff.nether_precision.up))&set_bonus.thewarwithin_season_3_4pc
    // # Barrage if Orb is available in AOE.
    // actions.spellslinger+=/arcane_barrage,if=active_enemies>1&buff.arcane_charge.stack=4&cooldown.arcane_orb.remains<gcd.max
    // # If you have High Voltage throw out a Barrage before you need to use Clearcasting for NP.
    // actions.spellslinger+=/arcane_barrage,if=talent.high_voltage&buff.arcane_charge.stack=4&buff.clearcasting.react&buff.nether_precision.stack=1
    // # Barrage with Orb Barrage or execute if you have orb up and no Nether Precision or no way to get another and use Arcane Orb to recover Arcane Charges, hold resources for Touch of the Magi if you have Magi's Spark. Skip this with Season 3 set.
    // actions.spellslinger+=/arcane_barrage,if=(active_enemies=1&(talent.orb_barrage|(target.health.pct<35&talent.arcane_bombardment))&(cooldown.arcane_orb.remains<gcd.max)&buff.arcane_charge.stack=4&(cooldown.touch_of_the_magi.remains>gcd.max*6|!talent.magis_spark)&(buff.nether_precision.down|(buff.nether_precision.stack=1&buff.clearcasting.stack=0)))&!set_bonus.thewarwithin_season_3_4pc
    // # Use Explosion for your first charge or if you have High Voltage you can use it for charge 2 and 3, but at a slightly higher target count.
    // actions.spellslinger+=/arcane_explosion,if=active_enemies>1&((buff.arcane_charge.stack<1&!talent.high_voltage)|(buff.arcane_charge.stack<3&(buff.clearcasting.react=0|talent.reverberate)))
    // # You can use Arcane Explosion in single target for your first 2 charges when you have no Clearcasting procs and aren't out of mana. This is only a very slight gain for some profiles so don't feel you have to do this.
    // actions.spellslinger+=/arcane_explosion,if=active_enemies=1&buff.arcane_charge.stack<2&buff.clearcasting.react=0
    // # Barrage in execute if you're at the end of Touch or at the end of Surge windows. Skip this with Season 3 set.
    // actions.spellslinger+=/arcane_barrage,if=(((target.health.pct<35&(debuff.touch_of_the_magi.remains<(gcd.max*1.25))&(debuff.touch_of_the_magi.remains>action.arcane_barrage.travel_time))|((buff.arcane_surge.remains<gcd.max)&buff.arcane_surge.up))&buff.arcane_charge.stack=4)&!set_bonus.thewarwithin_season_3_4pc
    // # Nothing else to do? Blast. Out of mana? Barrage.
    // actions.spellslinger+=/arcane_blast
    // actions.spellslinger+=/arcane_barrage
    return new bt.Action(() => bt.Status.Failure);
  }

  sunfury() {
    return new bt.Selector(
      spell.cast("Touch of the Magi", on => this.currentTarget, req => spell.getCooldown("Arcane Surge")?.timeleft > 40000 && this.arcaneCharges < 4 && this.currentTarget.timeToDeath() > 15),
      // # For Sunfury, Shifting Power only when you're not under the effect of any cooldowns.
      // actions.sunfury=shifting_power,if=((buff.arcane_surge.down & buff.siphon_storm.down & debuff.touch_of_the_magi.down & cooldown.evocation.remains > 15 & cooldown.touch_of_the_magi.remains > 10) & fight_remains > 10) & buff.arcane_soul.down & (buff.intuition.react = 0 | (buff.intuition.react & buff.intuition.remains > cast_time))
      spell.cast("Shifting Power", on => me, req => ((!me.hasAuraByMe("Arcane Surge") && !me.hasAuraByMe("Siphon Storm") && !this.currentTarget.hasAuraByMe("Touch of the Magi") && spell.getCooldown("Evocation")?.timeleft > 15000 && spell.getCooldown("Touch of the Magi")?.timeleft > 10000) && this.currentTarget.timeToDeath() > 10) && !me.hasAuraByMe("Arcane Soul") && (!me.hasAuraByMe("Intuition") || (me.hasAuraByMe("Intuition") && me.getVisibleAura("Intuition")?.remaining > 3000/* Shifting power cast time */))),
      // actions.sunfury+=/cancel_buff,name=presence_of_mind,use_off_gcd=1,if=(prev_gcd.1.arcane_blast&buff.presence_of_mind.stack=1)|active_enemies<4
      // actions.sunfury+=/presence_of_mind,if=debuff.touch_of_the_magi.remains<=gcd.max&buff.nether_precision.up&active_enemies<4
      spell.cast("Presence of Mind", on => me, req => this.currentTarget.getAuraByMe("Touch of the Magi")?.remaining <= this.gcdMax && me.hasAuraByMe("Nether Precision") && this.activeEnemies < 4),
      // actions.sunfury+=/wait,sec=0.05,if=time-action.presence_of_mind.last_used<0.015,line_cd=15
      // # When Arcane Soul is up, use Missiles to generate Nether Precision as needed while also ensuring you end Soul with 3 Clearcasting.
      // actions.sunfury+=/arcane_missiles,if=buff.nether_precision.down&buff.clearcasting.react&buff.arcane_soul.up&buff.arcane_soul.remains>gcd.max*(4-buff.clearcasting.react),interrupt_if=tick_time>gcd.remains,interrupt_immediate=1,interrupt_global=1,chain=1
      this.castArcaneMissiles(req => !me.hasAuraByMe("Nether Precision") && me.hasAuraByMe("Clearcasting") && me.hasAuraByMe("Arcane Soul") && me.getVisibleAura("Arcane Soul").remaining > this.gcdMax * (4000 - me.getVisibleAura("Clearcasting")?.remaining || 0), interrupt => !spell.isGlobalCooldown()),
      // not sure where to put this, want it often but not mess with CDs. Test out and see if we can lower priority
      spell.cast("Prismatic Barrier", on => me, req => !me.hasAuraByMe("Prismatic Barrier")),
      // actions.sunfury+=/arcane_barrage,if=buff.arcane_soul.up
      spell.cast("Arcane Barrage", on => this.currentTarget, req => me.hasAuraByMe("Arcane Soul")),
      // # Dump a clearcasting proc before you go into Soul if you have one.
      // actions.sunfury+=/arcane_missiles,if=buff.clearcasting.react&buff.arcane_surge.up&buff.arcane_surge.remains<gcd.max,interrupt_if=tick_time>gcd.remains,interrupt_immediate=1,interrupt_global=1,chain=1
      this.castArcaneMissiles(req => me.hasAuraByMe("Clearcasting") && me.hasAuraByMe("Arcane Surge") && me.getVisibleAura("Arcane Surge")?.remaining < this.gcdMax, interrupt => !spell.isGlobalCooldown()),
      // # Prioritize Tempo and Intuition if they are about to expire.
      // actions.sunfury+=/arcane_barrage,if=(buff.arcane_tempo.up&buff.arcane_tempo.remains<(gcd.max+(gcd.max*buff.nether_precision.stack=1)))|(buff.intuition.react&buff.intuition.remains<(gcd.max+(gcd.max*buff.nether_precision.stack=1)))
      spell.cast("Arcane Barrage", on => this.currentTarget, req => (me.hasAuraByMe("Arcane Tempo") && me.getVisibleAura("Arcane Tempo").remaining < (this.gcdMax + (this.gcdMax * me.getAuraStacks("Nether Precision") === 1))) || (me.hasAuraByMe("Intuition") && me.getVisibleAura("Intuition").remaining < (this.gcdMax + (this.gcdMax * me.getAuraStacks("Nether Precision") === 1)))),
      // # Gamble on Orb Barrage in AOE to prevent overcapping on Harmony stacks.
      // actions.sunfury+=/arcane_barrage,if=(talent.orb_barrage&active_enemies>1&buff.arcane_harmony.stack>=18&((active_enemies>3&(talent.resonance|talent.high_voltage))|buff.nether_precision.down|buff.nether_precision.stack=1|(buff.nether_precision.stack=2&buff.clearcasting.react=3)))
      spell.cast("Arcane Barrage", on => this.currentTarget, req => (me.hasVisibleAura("Orb Barrage") && this.activeEnemies > 1 && me.getAuraStacks("Arcane Harmony") >= 18 && ((this.activeEnemies > 3 && (me.hasVisibleAura("Resonance") || me.hasVisibleAura("High Voltage"))) || !me.hasAuraByMe("Nether Precision") || me.getAuraStacks("Nether Precision") === 1 || (me.getAuraStacks("Nether Precision") === 2 && me.getAuraStacks("Clearcasting") === 3)))),
      // # Spend Aether Attunement if you have 4pc S2 set before Touch.
      // actions.sunfury+=/arcane_missiles,if=buff.clearcasting.react&set_bonus.thewarwithin_season_2_4pc&buff.aether_attunement.react&cooldown.touch_of_the_magi.remains<gcd.max*(3-(1.5*(active_enemies>3&(!talent.time_loop|talent.resonance)))),interrupt_if=tick_time>gcd.remains&(buff.aether_attunement.react=0|(active_enemies>3&(!talent.time_loop|talent.resonance))),interrupt_immediate=1,interrupt_global=1,chain=1
      this.castArcaneMissiles(req => me.hasAuraByMe("Clearcasting") /*&& set_bonus.thewarwithin_season_2_4pc */ && me.hasAuraByMe("Aether Attunement") && spell.getCooldown("Touch of the Magi").timeleft < this.gcdMax * (3000 - (1500 * (this.activeEnemies > 3 && (!me.hasVisibleAura("Time Loop") || me.hasVisibleAura("Resonance"))))), interrupt => !spell.isGlobalCooldown() && (!me.hasAuraByMe("Aether Attunement") || (this.activeEnemies > 3 && (!me.hasVisibleAura("Time Loop") || me.hasVisibleAura("Resonance"))))),
      // # Barrage into Touch if you have charges when it comes up.
      // actions.sunfury+=/arcane_barrage,if=buff.arcane_charge.stack=4&((cooldown.touch_of_the_magi.ready)|cooldown.touch_of_the_magi.remains<((travel_time+50)>?gcd.max))&!variable.soul_cd
      spell.cast("Arcane Barrage", on => this.currentTarget, req => this.arcaneCharges === 4 && spell.getCooldown("Touch of the Magi")?.timeleft < this.gcdMax && !this.soulcd),
      // actions.sunfury+=/arcane_barrage,if=(cooldown.touch_of_the_magi.ready|(cooldown.touch_of_the_magi.remains<((travel_time+50)>?gcd.max)))&(buff.arcane_surge.down|(buff.arcane_surge.up&buff.arcane_surge.remains<=2.5))&variable.soul_cd
      spell.cast("Arcane Barrage", on => this.currentTarget, req => spell.getCooldown("Touch of the Magi")?.timeleft < this.gcdMax && (!me.hasAuraByMe("Arcane Surge") || (me.hasAuraByMe("Arcane Surge") && me.getVisibleAura("Arcane Surge").remaining < 2500)) && this.soulcd),
      // # Blast if Magi's Spark is up.
      // actions.sunfury+=/arcane_blast,if=debuff.magis_spark_arcane_blast.up&buff.arcane_charge.stack=4,line_cd=2
      spell.cast("Arcane Blast", on => this.currentTarget, req => this.currentTarget.hasAuraByMe("Magi's Spark") && this.arcaneCharges === 4),
      // # AOE Barrage conditions revolve around sending Barrages various talents. Whenever you have Clearcasting and Nether Precision or if you have Aether Attunement to recharge with High Voltage. Whenever you have Orb Barrage you should gamble basically any chance you get in execute. Lastly, with Arcane Orb available, you can send Barrage as long as you're not going to use Touch soon and don't have a reason to use Blast up.
      // actions.sunfury+=/arcane_barrage,if=(talent.high_voltage&active_enemies>1&buff.arcane_charge.stack=4&buff.clearcasting.react&buff.nether_precision.stack=1)
      spell.cast("Arcane Barrage", on => this.currentTarget, req => me.hasVisibleAura("High Voltage") && this.activeEnemies > 1 && this.arcaneCharges === 4 && me.hasAuraByMe("Clearcasting") && me.getAuraStacks("Nether Precision") === 1),
      // actions.sunfury+=/arcane_barrage,if=(talent.high_voltage&active_enemies>1&buff.arcane_charge.stack=4&buff.clearcasting.react&buff.aether_attunement.react&buff.glorious_incandescence.down&buff.intuition.down)
      spell.cast("Arcane Barrage", on => this.currentTarget, req => me.hasVisibleAura("High Voltage") && this.activeEnemies > 1 && this.arcaneCharges === 4 && me.hasAuraByMe("Clearcasting") && me.hasAuraByMe("Aether Attunement") && !me.hasAuraByMe("Glorious Incandescence") && !me.hasAuraByMe("Intuition")),
      // actions.sunfury+=/arcane_barrage,if=(active_enemies>2&talent.orb_barrage&talent.high_voltage&debuff.magis_spark_arcane_blast.down&buff.arcane_charge.stack=4&target.health.pct<35&talent.arcane_bombardment&(buff.nether_precision.up|(buff.nether_precision.down&buff.clearcasting.stack=0)))
      spell.cast("Arcane Barrage", on => this.currentTarget, req => (this.activeEnemies > 2 && me.hasVisibleAura("Orb Barrage") && me.hasVisibleAura("High Voltage") && !this.currentTarget.hasAuraByMe("Magi's Spark") && this.arcaneCharges == 4 && this.currentTarget.pctHealth < 35 && me.hasVisibleAura("Arcane Bombardment") && (me.hasAuraByMe("Nether Precision") || (!me.hasAuraByMe("Nether Precision") && !me.hasAuraByMe("Clearcasting"))))),
      //actions.sunfury+=/arcane_barrage,if=(active_enemies>2|(active_enemies>1&target.health.pct<35&talent.arcane_bombardment)) &cooldown.arcane_orb.remains<gcd.max&buff.arcane_charge.stack=4&cooldown.touch_of_the_magi.remains>gcd.max*6&(debuff.magis_spark_arcane_blast.down|!talent.magis_spark)&buff.nether_precision.up&(talent.high_voltage|((buff.leydrinker.down|(target.health.pct<35&talent.arcane_bombardment&active_enemies>=4&talent.resonance))&buff.nether_precision.stack=2)|(buff.nether_precision.stack=1&buff.clearcasting.react=0))
      spell.cast("Arcane Barrage", on => this.currentTarget, req => (this.activeEnemies > 2 || (this.activeEnemies > 1 && this.currentTarget.pctHealth < 35 && me.hasVisibleAura("Arcane Bombardment"))) && spell.getCooldown("Arcane Orb")?.timeleft < this.gcdMax && this.arcaneCharges == 4 && spell.getCooldown("Touch of the Magi")?.timeleft > this.gcdMax * 6 && (this.currentTarget.getAuraByMe("Magi's Spark") == undefined || !me.hasVisibleAura("Magi's Spark")) && me.hasAuraByMe("Nether Precision") && (me.hasVisibleAura("High Voltage") || ((!me.hasAuraByMe("Leydrinker") || (this.currentTarget.pctHealth < 35 && me.hasVisibleAura("Arcane Bombardment") && this.activeEnemies >= 4 && me.hasVisibleAura("Resonance"))) && me.getAuraStacks("Nether Precision") == 2) || (me.getAuraStacks("Nether Precision") == 1 && !me.hasAuraByMe("Clearcasting")))),
      // # Missiles to recoup Charges with High Voltage or maintain Nether Precision and combine it with other Barrage buffs.
      // actions.sunfury+=/arcane_missiles,if=buff.clearcasting.react & ((talent.high_voltage & buff.arcane_charge.stack < 4) | (buff.nether_precision.down &(buff.clearcasting.react > 1 | buff.spellfire_spheres.stack= 6 | buff.burden_of_power.up | buff.glorious_incandescence.up | (buff.intuition.react)))), interrupt_if = tick_time > gcd.remains & (buff.aether_attunement.react = 0 | (active_enemies > 3 & (!talent.time_loop | talent.resonance))), interrupt_immediate = 1, interrupt_global = 1, chain = 1
      this.castArcaneMissiles(req => me.hasAuraByMe("Clearcasting") && ((me.hasVisibleAura("High Voltage") && this.arcaneCharges < 4) || (!me.hasAuraByMe("Nether Precision") && (me.hasAuraByMe("Clearcasting") || me.getAuraStacks("Spellfire Spheres") == 6 || me.hasAuraByMe("Burden of Power") || me.hasAuraByMe("Glorious Incandescence") || me.hasAuraByMe("Intuition")))), interrupt => !spell.isGlobalCooldown() && (!me.hasAuraByMe("Aether Attunement") || (this.activeEnemies > 3 && (!me.hasVisibleAura("Time Loop") || me.hasVisibleAura("Resonance"))))),

      // # Arcane Orb to recover Charges quickly if below 3.
      // actions.sunfury+=/arcane_orb,if=buff.arcane_charge.stack<3
      spell.cast("Arcane Orb", on => this.currentTarget, req => this.arcaneCharges < 3 && this.facingForOrb()),
      // # Barrage with Incadescence or Intuition.
      // actions.sunfury+=/arcane_barrage,if=buff.glorious_incandescence.up|buff.intuition.react
      spell.cast("Arcane Barrage", on => this.currentTarget, req => me.hasAuraByMe("Glorious Incandescence") || me.hasAuraByMe("Intuition")),

      // # In AOE, Presence of Mind is used to build Charges. Arcane Explosion can be used to build your first Charge.
      // actions.sunfury+=/presence_of_mind,if=(buff.arcane_charge.stack=3|buff.arcane_charge.stack=2)&active_enemies>=3
      spell.cast("Presence of Mind", on => this.currentTarget, req => (this.arcaneCharges == 3 || this.arcaneCharges == 2) && this.activeEnemies >= 3),
      // actions.sunfury+=/arcane_explosion,if=buff.arcane_charge.stack<2&active_enemies>1
      spell.cast("Arcane Explosion", on => this.currentTarget, req => this.arcaneCharges < 2 && this.enemiesAroundMe(10) > 1),
      // actions.sunfury+=/arcane_blast
      spell.cast("Arcane Blast", on => this.currentTarget),
      // actions.sunfury+=/arcane_barrage
      spell.cast("Arcane Barrage", on => this.currentTarget),
    );
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.distanceTo2D(unit) <= 40 && me.isFacing(unit) && (Settings.AttackOOC || (unit.inCombatWithMe || (unit.inCombat() && me.inCombat()) || wow.Party.currentParty?.isUnitInCombatWithParty(unit)));
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAround(range).filter(unit => common.validTarget(unit)).length : 0;
  }

  enemiesAroundMe(range) {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= range);
    return targets?.length;
  }

  enemiesInFrontOfMe() {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= 8 && me.isFacing(unit, 60));
    return targets?.length;
  }

  facingForOrb() {
    const target = this.getCurrentTarget();
    return target ? me.isFacing(target, 8) : false;
  }

  enemiesForConeOfCold() {
    const targets = combat.targets.filter(unit => me.distanceTo2D(unit) <= 8 && me.isFacing(unit, 25));
    return targets?.length >= 3;
  }

  castArcaneMissiles(condition, interruptCondition) {
    return new bt.Sequence(
      spell.cast("Arcane Missiles", on => this.currentTarget, condition),
      new bt.Action(ret => {
        this.interruptCondition = interruptCondition;
        return bt.Status.Success;
      }),
    );
  }

  get arcaneCharges() {
    return me.powerByType(PowerType.ArcaneCharges)
  }
}
