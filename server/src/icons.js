/**
 * Icon and semantic-tag completion data for `.items` files (B10 + B11).
 *
 * Both lists are static — no REST call needed:
 *
 *  - `item_icon` is the `<icon>` clause after the label
 *    (`Switch X "label" <light>`; grammar: `item_icon: seq('<', field('name', $.identifier), '>')`).
 *    openHAB accepts its classic OH2 icon set (the "oh" icons, e.g. `light`,
 *    `temperature`, `door`) plus, since OH3, any Iconify icon name
 *    (`mdi:lightbulb`, `fa-solid:fan`, …). We bundle the classic set and let
 *    the `prefix:…` form pass through by completing the common prefixes.
 *  - `tag_list` is the `["Tag", …]` clause after the icon
 *    (grammar: `tag_list: seq('[', commaSep($._oh_string), ']')`). Values are
 *    semantic tags from openHAB's ontology — the full list from
 *    `SemanticTags.csv` in openhab-core (see `SEMANTIC_TAGS` below).
 */
'use strict'

/**
 * Classic openHAB (OH2) icon keywords usable inside `<…>`. This is the set
 * shipped by the classic UI / used by MainUI; OH3 additionally accepts any
 * Iconify name (`<mdi:lightbulb>`), which we surface via ICON_PREFIXES.
 */
const OH_ICONS = [
    'absorb',
    'airconditioner',
    'alarm',
    'arrow_down',
    'arrow_up',
    'asterisk',
    'attention',
    'babyphone',
    'bathtub',
    'battery',
    'bed',
    'bicycle',
    'blinds',
    'bluetooth',
    'boy',
    'briefcase',
    'calendar',
    'car',
    'cd',
    'chart',
    'clock',
    'computer',
    'contact',
    'delete',
    'door',
    'downstairs',
    'error',
    'fan',
    'female',
    'fire',
    'flower',
    'garage',
    'garbage',
    'girl',
    'group',
    'heating',
    'house',
    'humidity',
    'internet',
    'key',
    'light',
    'lightbulb',
    'lock',
    'machine',
    'male',
    'message',
    'motion',
    'network',
    'none',
    'oh',
    'office',
    'oven',
    'phone',
    'presence',
    'projector',
    'receiver',
    'refresh',
    'rollershutter',
    'screen',
    'settings',
    'siren',
    'slider',
    'smoke',
    'solar',
    'sound',
    'sport',
    'switch',
    'table',
    'temperature',
    'time',
    'tv',
    'upstairs',
    'video',
    'washer',
    'water',
    'window',
    'wind',
]

/** Iconify set prefixes accepted by openHAB 3+ inside `<…>` (e.g. `<mdi:lightbulb>`). */
const ICON_PREFIXES = ['mdi', 'fa-solid', 'fa-regular', 'fa-brands', 'wi', 'smarthome', 'oh']

/**
 * All semantic tags from openHAB's ontology, in CSV order, grouped by type
 * (Location / Point / Property / Equipment):
 * https://github.com/openhab/openhab-core/blob/main/bundles/org.openhab.core.semantics/model/SemanticTags.csv
 * All are valid in the `["…"]` tag list of an item definition.
 */
const SEMANTIC_TAGS = [
    // Top-level classes (the CSV `Type` column values; not listed as rows)
    'Equipment',
    'Point',
    'Property',
    'Location',
    // Location
    'Indoor',
    'Apartment',
    'Building',
    'Garage',
    'House',
    'Shed',
    'SummerHouse',
    'Corridor',
    'Floor',
    'Attic',
    'Basement',
    'FirstFloor',
    'GroundFloor',
    'SecondFloor',
    'ThirdFloor',
    'Room',
    'Bathroom',
    'Bedroom',
    'BoilerRoom',
    'Cellar',
    'DiningRoom',
    'Entry',
    'FamilyRoom',
    'GuestRoom',
    'Kitchen',
    'LaundryRoom',
    'LivingRoom',
    'Office',
    'Veranda',
    'Outdoor',
    'Carport',
    'Driveway',
    'Garden',
    'Patio',
    'Porch',
    'Terrace',
    // Point
    'Alarm',
    'Calculation',
    'Control',
    'Switch',
    'Forecast',
    'Measurement',
    'Setpoint',
    'Status',
    // Property
    'AirQuality',
    'AQI',
    'CO',
    'CO2',
    'Ozone',
    'ParticulateMatter',
    'Pollen',
    'Radon',
    'VOC',
    'Airconditioning',
    'Airflow',
    'App',
    'Brightness',
    'Channel',
    'Color',
    'ColorTemperature',
    'Current',
    'Duration',
    'Enabled',
    'Energy',
    'Frequency',
    'Gas',
    'Heating',
    'Humidity',
    'Illuminance',
    'Info',
    'Level',
    'Light',
    'LowBattery',
    'MediaControl',
    'Mode',
    'Moisture',
    'Motion',
    'Noise',
    'Oil',
    'Opening',
    'LockState',
    'OpenLevel',
    'OpenState',
    'Position',
    'GeoLocation',
    'Power',
    'Precipitation',
    'Rain',
    'Presence',
    'Pressure',
    'Price',
    'Progress',
    'QualityOfService',
    'SignalStrength',
    'RSSI',
    'Smoke',
    'SoundVolume',
    'Speed',
    'StateOfCharge',
    'Tampered',
    'Temperature',
    'Tilt',
    'Timestamp',
    'Ultraviolet',
    'Ventilation',
    'Vibration',
    'Voltage',
    'Water',
    'Wind',
    // Equipment
    'AlarmDevice',
    'AlarmSystem',
    'Application',
    'AudioVisual',
    'Display',
    'Projector',
    'Television',
    'MediaPlayer',
    'Receiver',
    'Screen',
    'Speaker',
    'Bed',
    'Camera',
    'CleaningRobot',
    'Computer',
    'ControlDevice',
    'Button',
    'Dial',
    'Keypad',
    'Slider',
    'WallSwitch',
    'Door',
    'BackDoor',
    'CellarDoor',
    'FrontDoor',
    'GarageDoor',
    'Gate',
    'InnerDoor',
    'SideDoor',
    'Doorbell',
    'DrinkingWater',
    'HotWaterFaucet',
    'WaterFilter',
    'WaterSoftener',
    'HVAC',
    'AirConditioner',
    'AirFilter',
    'Boiler',
    'Dehumidifier',
    'Fan',
    'CeilingFan',
    'ExhaustFan',
    'KitchenHood',
    'FloorHeating',
    'Furnace',
    'HeatPump',
    'HeatRecovery',
    'Humidifier',
    'RadiatorControl',
    'SmartVent',
    'Thermostat',
    'WaterHeater',
    'Horticulture',
    'Irrigation',
    'LawnMower',
    'SoilSensor',
    'LightSource',
    'AccentLight',
    'Chandelier',
    'Downlight',
    'FloodLight',
    'Lamp',
    'LightStrip',
    'LightStripe',
    'Lightbulb',
    'Pendant',
    'Sconce',
    'SpotLight',
    'TrackLight',
    'WallLight',
    'Lock',
    'NetworkAppliance',
    'Firewall',
    'NetworkSwitch',
    'Router',
    'WirelessAccessPoint',
    'PetCare',
    'Aquarium',
    'PetFeeder',
    'PetFlap',
    'PowerOutlet',
    'PowerSupply',
    'Battery',
    'EVSE',
    'Generator',
    'Inverter',
    'SolarPanel',
    'TransferSwitch',
    'UPS',
    'WindGenerator',
    'Printer',
    'Printer3D',
    'Pump',
    'WaterFeature',
    'RemoteControl',
    'Sensor',
    'AirQualitySensor',
    'CO2Sensor',
    'COSensor',
    'ContactSensor',
    'ElectricMeter',
    'FireDetector',
    'FlameDetector',
    'HeatDetector',
    'SmokeDetector',
    'GasMeter',
    'GlassBreakDetector',
    'HumiditySensor',
    'IlluminanceSensor',
    'LeakSensor',
    'OccupancySensor',
    'MotionDetector',
    'TemperatureSensor',
    'VibrationSensor',
    'WaterMeter',
    'WaterQualitySensor',
    'WeatherStation',
    'Siren',
    'Smartphone',
    'Tool',
    'Tracker',
    'Valve',
    'Vehicle',
    'Car',
    'VoiceAssistant',
    'WebService',
    'WeatherService',
    'Wellness',
    'Chlorinator',
    'Jacuzzi',
    'PoolCover',
    'PoolHeater',
    'Sauna',
    'Shower',
    'SwimmingPool',
    'WhiteGood',
    'AirFryer',
    'CoffeeMaker',
    'Cooktop',
    'Dishwasher',
    'Dryer',
    'FoodProcessor',
    'Freezer',
    'Fryer',
    'IceMaker',
    'Microwave',
    'Mixer',
    'Oven',
    'Range',
    'Refrigerator',
    'Toaster',
    'WashingMachine',
    'Window',
    'WindowCovering',
    'Blinds',
    'Drapes',
    'Zone',
    'AlarmZone',
]

/** LSP CompletionItemKind.Keyword */
const KIND_KEYWORD = 14

/** LSP CompletionItemKind.EnumMember (semantic tags behave like enum members) */
const KIND_ENUM_MEMBER = 20

/**
 * Replace the contents of complete `"…"` pairs with nothing (quotes kept), so
 * clause characters inside string literals don't confuse the clause-position
 * checks below.
 */
function maskCompleteStrings(s) {
    return s.replace(/"[^"\n]*"/g, '""')
}

/** Item-definition line prefix (masked): `Type[:…] Name` plus the optional
 * label / icon / groups / tag-list-open clauses that may precede the cursor.
 * The trailing `$` anchor is optional via `rest` so the same shape can also
 * match a prefix that ends in an unclosed clause (`<`, `[`). */
// Two shapes: with an open clause at the end (`<…` or `[…`), and with the
// icon clause complete and closed (`<light>`), for the tag-list check.
const ITEM_PREFIX_OPEN_RE =
    /^\s*[A-Za-z_]\w*(?::[\w(),=]+)*\s+[A-Za-z_]\w*(\s+"")?(\s*<[^>\n]*)?(\s*\([^)]*\))?(\s*\[[^\]\n]*)?$/
const ITEM_PREFIX_ICON_CLOSED_RE =
    /^\s*[A-Za-z_]\w*(?::[\w(),=]+)*\s+[A-Za-z_]\w*(\s+"")?(\s*<[^>\n]*>)?(\s*\([^)]*\))?(\s*\[[^\]\n]*)?$/

/**
 * True when the cursor is inside the `<…>` icon clause of an `.items`
 * definition line: an unclosed `<` at clause position. The label is optional
 * (`Switch X <light>` is valid), so the `<` may directly follow the item name.
 */
function isIconPosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    const { before } = context
    if (before.includes('//')) {
        return false
    }
    // Inside an unclosed string (the label, or a config value) there is no
    // icon clause — an odd quote count means the cursor is in a string.
    const quotes = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length
    if (quotes % 2 === 1) {
        return false
    }
    // An unclosed `<` at clause position: the masked line must match the
    // item prefix up to and including the open `<…` clause.
    const masked = maskCompleteStrings(before)
    return /<[^>\n]*$/.test(masked) && ITEM_PREFIX_OPEN_RE.test(masked)
}

/**
 * True when the cursor is inside a quoted string of the `["…", "…"]` tag
 * list on an `.items` definition line. The label/icon/groups clauses before
 * the `[` are all optional; a `=` between `[` and the cursor excludes the
 * Location config `[ latitude="…" ]` (and mappings).
 */
function isTagPosition(extension, context) {
    if (extension !== 'items') {
        return false
    }
    const { before } = context
    if (before.includes('//')) {
        return false
    }
    // The cursor must be inside an unclosed string (the tag being typed).
    const quotes = (before.match(/"/g) || []).length
    if (quotes % 2 === 0) {
        return false
    }
    const lastQuote = before.lastIndexOf('"')
    const head = before.slice(0, lastQuote)
    const bracket = head.lastIndexOf('[')
    if (bracket === -1) {
        return false
    }
    const inside = head.slice(bracket + 1)
    // Location config / mappings carry `key=`; already-typed tags are `"…", `.
    if (inside.includes('=') || !/^(\s*"[^"]*"\s*,?)*\s*$/.test(inside)) {
        return false
    }
    // A complete icon clause `<light>` precedes the tag list; drop it so the
    // prefix check sees the plain `Type Name ["…` shape (an open `<…` would
    // have failed the unclosed-string quote check above).
    const masked = maskCompleteStrings(head)
    return ITEM_PREFIX_ICON_CLOSED_RE.test(masked)
}

/** Icon completions for the partial inside `<…>`. */
function iconCompletions(partial) {
    const items = OH_ICONS.filter((icon) => icon.startsWith(partial.toLowerCase())).map((icon) => ({
        label: icon,
        kind: KIND_KEYWORD,
        detail: 'openHAB icon',
    }))
    // Offer Iconify prefixes when the partial looks like `pr` or `md`.
    for (const prefix of ICON_PREFIXES) {
        if (prefix.startsWith(partial.toLowerCase()) && !prefix.includes(':')) {
            items.push({ label: `${prefix}:`, kind: KIND_KEYWORD, detail: 'iconify set' })
        }
    }
    return items
}

/** Semantic-tag completions for the partial inside `["…"]`. */
function tagCompletions(partial, extraTags = []) {
    const seen = new Set()
    const items = []
    for (const tag of [...extraTags, ...SEMANTIC_TAGS]) {
        if (seen.has(tag) || !tag.toLowerCase().startsWith(partial.toLowerCase())) {
            continue
        }
        seen.add(tag)
        items.push({ label: tag, kind: KIND_ENUM_MEMBER, detail: 'semantic tag' })
    }
    return items
}

module.exports = { OH_ICONS, ICON_PREFIXES, SEMANTIC_TAGS, isIconPosition, isTagPosition, iconCompletions, tagCompletions }
