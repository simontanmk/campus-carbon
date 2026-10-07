# Credits and third-party terms

The code in this repository is MIT-licensed (see `LICENSE`). The data below keeps its own licence. If you reuse it, credit it as shown.

## Data

- **Campus locations and walking/driving routes** (`seed/data.ts` coordinates, `seed/routes.json`)
  - © OpenStreetMap contributors. Available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See https://www.openstreetmap.org/copyright.
  - Coordinates come from Nominatim. Routes were computed with OSRM on the FOSSGIS server (routing.openstreetmap.de).
  - `seed/routes.json` is a derived database. It is made available under the ODbL 1.0, not the MIT licence.
- **Food emission factors** (`seed/data.ts`, `FACTORS`)
  - Poore, J. & Nemecek, T. (2018), "Reducing food's environmental impacts through producers and consumers", *Science* 360(6392), 987–992.
  - Retrieved via Our World in Data, https://ourworldindata.org/grapher/ghg-per-kg-poore. Our World in Data publishes it under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Transport emission factors** (bus, petrol car)
  - UK Department for Energy Security and Net Zero (DESNZ), *Greenhouse gas reporting: conversion factors 2022*, via Our World in Data.
  - Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## Software

Runtime dependencies are open source: 26 MIT, 7 ISC and 1 Apache-2.0 package. The Apache-2.0 package is [jsQR](https://github.com/cozmo/jsQR) by Cosmo Wolfe, which reads reward QR codes on the seller's screen. Full licence texts ship inside each package in `node_modules` and are listed in `package-lock.json`.
