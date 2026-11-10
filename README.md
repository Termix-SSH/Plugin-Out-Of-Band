<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>Out-of-band</h1>

<p>Power, sensors, event logs and consoles for server BMCs over Redfish, IPMI and Intel AMT</p>

<!-- VIDEO:START -->

<a href="https://www.youtube.com/watch?v=nrSv4fZd1B4"><img src="https://img.shields.io/badge/Watch_the_demo-f59145?style=for-the-badge&logo=youtube&logoColor=white" alt="Watch the demo on YouTube" /></a>

<!-- VIDEO:END -->

</div>

<br />

## Overview

Out-of-band adds the management controllers (BMCs) of your servers to Termix. Power a machine on or off even when its OS is dead, watch temperatures and fans, read the hardware event log and boot from an ISO.

Read the [docs](https://docs.termix.site/plugins/out-of-band) to set it up and use it.

<br />

## Features

- Redfish (iDRAC, iLO, Supermicro, OpenBMC), IPMI over LAN and Intel AMT
- Power on, shut down, power cycle and reset
- Temperatures, fans, voltages and power supplies, with alerts
- Hardware event log, read and clear
- Boot once from PXE, disk, CD, USB or BIOS setup
- Mount an ISO from a web address as virtual media (Redfish)
- Serial over LAN console through a relay host (IPMI)
- Link a BMC to a Termix host, or reach IPMI through any SSH host
- Logins are stored encrypted and never shown again
- A dashboard card and Termix actions for power

<br />

## Sponsors

For a paid sponsor spot, email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.blacksmith.sh/">
  <img src="https://termix.site/img/sponsors/blacksmith.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://termix.site/img/sponsors/cloudflare.png" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://termix.site/img/sponsors/akamai.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://termix.site/img/sponsors/aws.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://termix.site/img/sponsors/rackgenius.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://termix.site/img/sponsors/ginernet.png" height="40" alt="Ginernet" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.hetzner.com/?mtm_campaign=termix&mtm_medium=referral&mtm_content=sponsoring_link">
  <img src="https://termix.site/img/sponsors/hetzner.png" height="40" alt="Hetzner" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://emberswan.com/">
  <img src="https://termix.site/img/sponsors/emberswan.png" height="40" alt="Ember Swan" />
</a>

</div>

<!-- SPONSORS:END -->

<br />

## Support

Bugs and ideas for Out-of-band go in this repo: [report a bug](https://github.com/Termix-SSH/Plugin-Out-Of-Band/issues/new?template=bug_report.yml) or [request a feature](https://github.com/Termix-SSH/Plugin-Out-Of-Band/issues/new?template=feature_request.yml). Report an issue on the plugin's page in the Plugins tab fills in your versions for you.

Problems with Termix itself (login, hosts, credentials, sharing, sync) go in the [Termix repo](https://github.com/Termix-SSH/Termix/issues/new/choose). Not sure where it goes? Open it there and it will be moved.

Add as much detail as you can, in English if possible. For questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Apache License 2.0. See [LICENSE](LICENSE).
