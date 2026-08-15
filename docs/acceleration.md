Well. I'm on a roll it seems. Today, in collaboration with GPT, I finalized* the equations for the time and distance required for a train to accelerate.

Acceleration under constant power [is tricky enough](https://imgur.com/a/kOKfkLR). But when you factor in rolling friction, it gets properly ugly. I'm not going to be able to post the equations in text form here, like I usually do. Instead I will take some screenshots of the equations typed into Desmos, for your viewing pleasure. And if you want to fiddle with them, you can do that too.

I usually like to work through the math. I'm not going to. Not for this. Because a) I don't fully understand it myself (that's where GPT comes in to save the day), and b) it's not going to be of any help to anyone any more than just looking at the final equations. If you know that level of calculus, you know. If not, doesn't matter.

One thing I can do is explain the various inputs and outputs, to make it easier to digest.

###Inputs

* `m`: mass
* `P`: power
* `T`: tractive effort
* `v`: top speed (or other target speed)
* `v_0`: the initial speed
 * Usually zero, but you can use whatever you like that's less than v.
* `v_t`: the speed at the tractive threshold `v_t = P/T`.
* `v_1`: equal to `v_t` or `v_0`, whichever is **higher**.

Note: [Tractive effort is actually double of what it says](https://imgur.com/a/vA9kYON) (yes, it's very upsetting). You can see this for yourself using the console commands:

    # Show all lines → lineID — easier if you only have one line. :)
    api.engine.system.lineSystem.getLines()

    # Get vehicles (trains) on a line by line ID → trainID
    api.engine.system.transportVehicleSystem.getLineVehicles(lineID)

    # Get info on that train by its ID (as seen in the screenshot above)
    api.engine.system.trainMoveSystem.getTrainInfo(trainID)

#####Rolling resistance

* `g`: gravitational acceleration
* `C`: [friction coefficient](https://en.wikipedia.org/wiki/Rolling_resistance)
* `R`: the rolling resistance `R = mgC`


###Outputs

* `t_1` and `d_1`: the time and distance from `v_0` to the tractive threshold `v_t`
 * Constant acceleration
 * If `v_0 >= v_t` then these are necessarily zero.
* `t_2` and `d_2`: the time and distance from `v_t` to `v`
 * Constant power → variable acceleration
   
###The formulas

* [Equations in screenshot form](https://imgur.com/a/8VXnl8K)
* [Equations in their full glory on Desmos](https://www.desmos.com/calculator/pzhondtwrd)
 * No graphs, just pretty (ugly) equations and the resulting numbers.
* Spreadsheet coming

###Experimental verification

* Tested and verified with 1.6 % error on a D 1/3 (lone locomotive).
* Tested and verified with 0.06 % (time) and 0.17 % (distance) error on an Avelia Liberty.

I think that is sufficient to say that it is perfectly accurate, and the rest is measurement error.

###Caveat

There is one fairly sizeable caveat. Above ~95 % of top speed, the game tapers the acceleration by some custom formula. This is not accounted for. Because it can't be done in this format. (It has to be done iteratively in a simulation or something.)

This tapering leads to a huge difference between prediction and observation, in the time and distance from 95 % to top speed (again using the Avelia Liberty as an example):

||Predicted|Observed|Difference|% Diff
-|-|-|-|-
Time to 95 %|329 s|329 s|0 s|0.0 %
Distance to 95 %|17,385 m|17,414 m|29 m|0.17 %
Time to v_max|366 s|397 s|31 s|8.4 %
Distance to v_max|20,408 m|23,015 m|2607 m|12.8%
Time 95 % to v_max|37 s|68 s|31 s|83.8 %
Distance 95 % to v_max|3023 m|5601 m|2578 m|85.3 %

In plain words: The tapering off of the acceleration makes it take *much* longer than without tapering.

The formula for the tapering factor:

* `f(v) = sqrt(clamp(20 * (v/k - 0.95), 0, 1))`
 * where `k = v_max + 0.136`
 * clamping is necessary because it does funny things near the outer bounds (like being undefined in the real numbers, or producing complex numbers if you enjoy that sort of thing)

Alone it produces a curve that looks like this:

* [*Very* exaggerated view showing the curvature](https://imgur.com/a/nVpDFCG)
* [In actuality it's pretty flat](https://imgur.com/a/a0GwPv6)
* [Desmos](https://www.desmos.com/calculator/gpt6bqm9z6)

The way to apply it, as far as I can figure, is simply modifying `a = a * ( 1 - f(v) )`.

So there you go. Make of this what you will. Use it for what it's worth. I reckon it will be most useful in determining the time and distance to some speed considerably lower than all of the above, where that speed is one you've calculated already as the break-even speed of the train. Which you can probably do with [some of this stuff](https://www.reddit.com/r/TransportFever2/comments/1m4kqws/tfscience_my_lifes_work_is_complete/). So for that the above 95 % stuff is thankfully uninteresting.

###Edit

I have worked out that the tapering can be approximated quite closely with some logarithmic fun. What you will need to do is split the time and distance calculations at 95 % of top speed (or if you want to be super accurate, `0.95(v_max + 0.136)` *for reasons*), so that you have:

* `t_1` and `d_1` up to `v_t`
* `t_2` and `d_2` up to 95 % of top speed
* `t_3` and `d_3` from 95 % to top speed

Then simply multiply:

* `new_t_3 = t_3 * 1.89 ln(v_max) - 2.05`
* `new_d_3 = d_3 * 1.92 ln(v_max) - 2.10`

And if I've done that right, that should get you really quite close! In fact according to my calculations, it's so close it's essentially exact, as I'm showing an absolute deviation from the simulated result at mostly 0.0 %, and rarely 0.1 %. The *sum* of the the deviations for both time and distance across 85 trains is 1.96 %! Dividing that by 170 values is 0.01 % on average. That's tiny!