<?php

namespace Api\Model\Shared\Mapper;

use Litipk\Jiffy\UniversalTimestamp;
use Palaso\Utilities\CodeGuard;

class JsonDecoder
{
    /**
     * @param array $array
     * @return bool true if at least one key is a string, false otherwise
     */
    public static function is_assoc($array)
    {
        return (bool) count(array_filter(array_keys($array), 'is_string'));
    }

    /**
     * Sets the public properties of $model to values from $values[propertyName]
     * @param object $model
     * @param array $values A mixed array of JSON (like) data.
     * @param string $id
     */
    public static function decode($model, $values, $id = '')
    {
        $decoder = new JsonDecoder();
        $decoder->_decode($model, $values, $id);
    }

    /**
     * Sets the public properties of $model to values from $values[propertyName]
     * @param object|MapOf $model
     * @param array $values A mixed array of JSON (like) data.
     * @param string $id
     * @throws \Exception
     */
    protected function _decode($model, $values, $id)
    {
        CodeGuard::checkTypeAndThrow($values, 'array');
        $propertiesToIgnore = $this->getPrivateAndReadOnlyProperties($model);
        foreach ($this->getProperties($model) as $property => $value) {
            if (is_a($value, 'Api\Model\Shared\Mapper\Id') && get_class($value) == 'Api\Model\Shared\Mapper\Id') {
                 $this->decodeId($property, $model, $values, $id);
                 continue;
            }
            if (!array_key_exists($property, $values) || in_array($property, $propertiesToIgnore)) {
                continue;
            }
            if ($value === false) {
                $value = $model->{$property}; // To force the lazy evaluation to create the property.
            }
            if (is_a($model, 'Api\Model\Languageforge\Lexicon\LexSense')) {
                $go = 'here';
            }
            if (is_a($value, 'Api\Model\Shared\Mapper\IdReference')) {
                $this->decodeIdReference($property, $model, $values);
            } elseif (is_a($value, 'Api\Model\Shared\Mapper\ArrayOf')) {
                $this->decodeArrayOf($property, $model->{$property}, $values[$property]);
            } elseif (is_a($value, 'Api\Model\Shared\Mapper\MapOf')) {
                $this->decodeMapOf($property, $model->{$property}, $values[$property]);
            } elseif (is_a($value, 'DateTime')) {
                $this->decodeDateTime($model->{$property}, $values[$property]);
            } elseif (is_a($value, 'Litipk\Jiffy\UniversalTimestamp')) {
                $this->decodeUniversalTimestamp($model->{$property}, $values[$property]);
            } elseif (is_a($value, 'Api\Model\Shared\Mapper\ReferenceList')) {
                $this->decodeReferenceList($model->{$property}, $values[$property]);
            } elseif (is_object($value)) {
                $this->_decode($model->{$property}, $values[$property], '');
            } else {
                if (is_array($values[$property])) {
                    throw new \Exception("Must not decode array in '" . get_class($model) . "->" . $property . "'");
                }
                $model->{$property} = $values[$property];
            }
        }

        // support for nested MapOf
        if (is_a($model, 'Api\Model\Shared\Mapper\MapOf')) {
            $this->decodeMapOf($id, $model, $values);
        }

        $this->postDecode($model);
    }

    protected function postDecode($model)
    {
    }

    /**
     * @param string $key
     * @param object $model
     * @param array $values
     */
    public function decodeIdReference($key, $model, $values)
    {
        $model->$key = new IdReference($values[$key]);
    }

    /**
     * @param string $key
     * @param object $model
     * @param array $values
     * @param string $id
     */
    public function decodeId($key, $model, $values,
        /** @noinspection PhpUnusedParameterInspection (used by inherited function) */
        $id)
    {
        $model->$key = new Id($values[$key]);
    }

    /**
     * @param string $key
     * @param ArrayOf $model
     * @param array $data
     * @throws \Exception
     */
    public function decodeArrayOf($key, $model, $data)
    {
        if ($data == null) {
            $data = array();
        }
        CodeGuard::checkTypeAndThrow($data, 'array');
        $propertiesToKeep = array();

        if (($key == 'senses') && (get_class($this) != 'Api\Model\Shared\Mapper\MongoDecoder')) {
            $go = 'here';
        }
        // check if array item class has any private, read-only or recursive properties
        if (get_class($this) != 'Api\Model\Shared\Mapper\MongoDecoder' && $model->hasGenerator()) {
            $arrayItem = $model->generate();
            $propertiesToKeep = $this->getPrivateAndReadOnlyProperties($arrayItem);
            $propertiesToKeep = $this->getRecursiveProperties($arrayItem, $propertiesToKeep);
        }

        $oldModelArray = $model->exchangeArray(array());
        foreach ($data as $index => $item) {
            if ($model->hasGenerator()) {
                $object = $model->generate($item);

                // put back private, read-only and recursive properties into new object that was just generated
                if ((count($oldModelArray) > 0) && (count($propertiesToKeep) > 0)) {
                    $this->restoreProperties($object, $oldModelArray, $index, $propertiesToKeep);
                }

                $this->_decode($object, $item, '');
                $model[] = $object;
            } else {
                if (is_array($item)) {
                    throw new \Exception("Must not decode array for value type '$key'");
                }
                $model[] = $item;
            }
        }
    }

    /**
     * @param string $key
     * @param MapOf $model
     * @param array $data
     * @throws \Exception
     */
    public function decodeMapOf($key, $model, $data)
    {
        if (is_null($data) || !is_array($data) && get_class($data) == 'stdClass') {
            $data = array();
        }
        CodeGuard::checkTypeAndThrow($data, 'array');
        $propertiesToKeep = array();

        // check if array item class has any private, read-only or recursive properties
        if (get_class($this) != 'Api\Model\Shared\Mapper\MongoDecoder' && $model->hasGenerator()) {
            foreach ($data as $itemKey => $item) {
                $mapItem = $model->generate($item);
                $propertiesToKeep = $this->getPrivateAndReadOnlyProperties($mapItem, $propertiesToKeep);
                $propertiesToKeep = $this->getRecursiveProperties($mapItem, $propertiesToKeep);
            }
        }

        $oldModelArray = $model->exchangeArray(array());
        foreach ($data as $itemKey => $item) {
            if ($model->hasGenerator()) {
                $object = $model->generate($item);

                // put back private, read-only and recursive properties into new object that was just generated
                foreach ($propertiesToKeep as $property) {
                    if (array_key_exists($itemKey, $oldModelArray) && property_exists($oldModelArray[$itemKey], $property)) {
                        $object->{$property} = $oldModelArray[$itemKey]->{$property};
                    }
                }
                $this->_decode($object, $item, $itemKey);
                $model[$itemKey] = $object;
            } else {
                if (is_array($item)) {
                    throw new \Exception("Must not decode array for value type '$key'");
                }
                $model[$itemKey] = $item;
            }
        }
    }

    /**
     * Put back private, read-only and recursive properties into new object that was just generated
     * @param array $object
     * @param array $oldModelArray
     * @param $index
     * @param array $propertiesToKeep
     * @throws \Exception
     */
    public function restoreProperties(&$object, $oldModelArray, $index, $propertiesToKeep) {
        CodeGuard::checkTypeAndThrow($object, 'array');
        CodeGuard::checkTypeAndThrow($oldModelArray, 'array');

        // Attempt to match the index by guid
        if (array_key_exists('guid', $object) && (count($oldModelArray) > 0)) {
            $index = array_search($object->guid, array_column($oldModelArray, 'guid'));
            if ($index === false) {
                return;
            }
        }

        // TODO: what to do if guid not found?  Old way was copy by index...
        foreach ($propertiesToKeep as $property) {
            if (array_key_exists($index, $oldModelArray)) {
                $object->{$property} = $oldModelArray[$index]->{$property};
            }
        }
    }

    /**
     * Decodes the mongo array into the ReferenceList $model
     * @param ReferenceList $model
     * @param array $data
     * @throws \Exception
     */
    public function decodeReferenceList($model, $data)
    {
        $model->refs = array();
        if (array_key_exists('refs', $data)) {
            // This likely came from an API client, who shouldn't be sending this.
            return;
        }
        $refsArray = $data;
        foreach ($refsArray as $objectId) {
            CodeGuard::checkTypeAndThrow($objectId, 'string');
            array_push($model->refs, new Id((string) $objectId));
        }
    }

    /**
     * @param \DateTime $model
     * @param string $data
     */
    public function decodeDateTime(&$model, $data)
    {
        $model = new \DateTime($data);
    }

    /**
     * @param UniversalTimestamp $model
     * @param string $data
     */
    public function decodeUniversalTimestamp(&$model, $data)
    {
        if ($data !== null) {
            $model = UniversalTimestamp::fromWhatever($data);
        }
    }

    /**
     * @param ObjectForEncoding|object $model
     * @param array $properties to merge
     * @return array
     */
    private function getPrivateAndReadOnlyProperties($model, $properties = array())
    {
        if (get_class($this) != 'Api\Model\Shared\Mapper\MongoDecoder') {
            if (method_exists($model, 'getPrivateProperties')) {
                $properties = array_merge($properties, (array)$model->getPrivateProperties());
            }
            if (method_exists($model, 'getReadOnlyProperties')) {
                $properties = array_merge($properties, (array)$model->getReadOnlyProperties());
            }
        }

        return $properties;
    }

    /**
     * @param object $model
     * @param array $properties to merge
     * @return array
     */
    private function getRecursiveProperties($model, $properties = array())
    {
        if (get_class($this) != 'Api\Model\Shared\Mapper\MongoDecoder') {
            foreach ($this->getProperties($model) as $property => $value) {
                if ($value === false) {
                    $value = $model->{$property}; // To force the lazy evaluation to create the property.
                }

                if (is_object($value)) {
                    if (get_class($value) == 'Api\Model\Shared\Mapper\ArrayOf' && !in_array($property, $properties)) {
                        $properties[] = $property;
                    } elseif (get_class($value) == 'Api\Model\Shared\Mapper\MapOf' && !in_array($property, $properties)) {
                        $properties[] = $property;
                    }
                }
            }
        }

        return $properties;
    }

    /**
     * @param ObjectForEncoding|object $model
     * @return array
     */
    private function getProperties($model)
    {
        $properties = get_object_vars($model);
        if (method_exists($model, 'getLazyProperties')) {
            $properties = array_merge($properties, $model->getLazyProperties());
        }

        return $properties;
    }
}
