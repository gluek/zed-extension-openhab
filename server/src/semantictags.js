/**
 * Semantic-tag data and completions for `.items` files (B11).
 *
 * The `tag_list` is the `["Tag", …]` clause after the icon
 * (grammar: `tag_list: seq('[', commaSep($._oh_string), ']')`). Values are
 * semantic tags from openHAB's ontology — the full list from
 * `SemanticTags.csv` in openhab-core (see `SEMANTIC_TAGS` below).
 * Static — no REST call needed.
 */
'use strict'

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

/** Item-definition line prefix (masked) with the icon clause complete and
 * closed (`<light>`), up to the open `[…` tag list: the shape required for a
 * tag-position match. */
const ITEM_PREFIX_ICON_CLOSED_RE =
    /^\s*[A-Za-z_]\w*(?::[\w(),=]+)*\s+[A-Za-z_]\w*(\s+"")?(\s*<[^>\n]*>)?(\s*\([^)]*\))?(\s*\[[^\]\n]*)?$/

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

module.exports = { SEMANTIC_TAGS, isTagPosition, tagCompletions, maskCompleteStrings }
